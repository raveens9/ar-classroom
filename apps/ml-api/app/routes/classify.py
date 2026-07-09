"""POST /v1/classify

Runs the student's cutout through the correct QuickDraw CNN based on the room topic:
  - topic="animals"    → image_classifier_fyp.keras         (butterfly, cat, dog, fish)
  - topic="nature"     → image_classifier_nature.keras       (cloud, flower, rain, rainbow, sun, tree)
  - topic="letters"    → image_classifier_alphabet.keras     (A–Z)
  - topic="numbers"    → image_classifier_numbers.keras      (0–9)
  - topic="vehicles"   → image_classifier_vehicles.keras     (car, airplane, sailboat, van)
  - topic="vegetables" → image_classifier_vegetables.keras   (carrot, broccoli, corn, mushroom, pumpkin)
"""
from __future__ import annotations

import io
import logging
import os
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel

router = APIRouter()
log = logging.getLogger("ml-api.classify")

_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

TOPIC_CONFIG: dict[str, dict] = {
    "animals": {
        "path": _MODELS_DIR / "image_classifier_fyp.keras",
        "classes": ["butterfly", "cat", "dog", "fish"],
        "anim": {"butterfly": "fly", "cat": "walk", "dog": "run", "fish": "swim"},
    },
    "nature": {
        "path": _MODELS_DIR / "image_classifier_nature.keras",
        "classes": ["cloud", "flower", "rain", "rainbow", "sun", "tree"],
        "anim": {"cloud": "idle", "flower": "idle", "rain": "idle", "rainbow": "idle", "sun": "idle", "tree": "idle"},
    },
    "letters": {
        "path": _MODELS_DIR / "image_classifier_alphabet.keras",
        "classes": [chr(c) for c in range(ord("A"), ord("Z") + 1)],
        "anim": {chr(c): "idle" for c in range(ord("A"), ord("Z") + 1)},
    },
    "numbers": {
        "path": _MODELS_DIR / "image_classifier_numbers.keras",
        "classes": [str(i) for i in range(10)],
        "anim": {str(i): "idle" for i in range(10)},
    },
    "vehicles": {
        "path": _MODELS_DIR / "image_classifier_vehicles.keras",
        "classes": ["car", "airplane", "sailboat", "van"],
        "anim": {"car": "drive", "airplane": "fly", "sailboat": "sail", "van": "drive"},
    },
    "vegetables": {
        "path": _MODELS_DIR / "image_classifier_vegetables.keras",
        "classes": ["carrot", "broccoli", "corn", "mushroom", "pumpkin"],
        "anim": {k: "idle" for k in ["carrot", "broccoli", "corn", "mushroom", "pumpkin"]},
    },
}

_models: dict[str, object] = {}


def _get_model(topic: str):
    if topic not in _models:
        import tensorflow as tf
        cfg = TOPIC_CONFIG[topic]
        log.info("Loading %s classifier from %s", topic, cfg["path"])
        _models[topic] = tf.keras.models.load_model(str(cfg["path"]))
        log.info("%s classifier ready — classes: %s", topic, cfg["classes"])
    return _models[topic]


def _preprocess(img_bytes: bytes) -> np.ndarray:
    """
    Convert any canvas drawing into the 28x28 float32 array the QuickDraw models expect.
    Works for dark or white canvas backgrounds, any stroke colour.
    """
    img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    white_bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    white_bg.paste(img, mask=img.split()[3])
    grey = np.array(white_bg.convert("L"), dtype="float32")

    h, w = grey.shape

    # Detect background using histogram — the most common grey level is background.
    # Works for dark canvas (background≈20) AND white canvas (background≈255).
    hist, bin_edges = np.histogram(grey.flatten(), bins=32, range=(0.0, 256.0))
    bg_bin = int(np.argmax(hist))
    bg_value = (bin_edges[bg_bin] + bin_edges[bg_bin + 1]) / 2.0
    log.info("background detected at grey=%.0f", bg_value)

    ink_mask = np.abs(grey - bg_value) > 35

    if not ink_mask.any():
        log.warning("No ink detected — returning blank array")
        return np.zeros((1, 28, 28, 1), dtype="float32")

    rows = np.where(np.any(ink_mask, axis=1))[0]
    cols = np.where(np.any(ink_mask, axis=0))[0]
    pad = max(4, int(max(h, w) * 0.04))
    r0 = max(0, rows[0] - pad)
    r1 = min(h, rows[-1] + pad + 1)
    c0 = max(0, cols[0] - pad)
    c1 = min(w, cols[-1] + pad + 1)
    ink_crop = ink_mask[r0:r1, c0:c1]

    binary = (ink_crop * 255).astype("uint8")
    resized = Image.fromarray(binary).resize((28, 28), Image.LANCZOS)
    arr = np.array(resized, dtype="float32") / 255.0

    # DEBUG: save the 28x28 image the model actually sees — check /static/debug_input.png
    debug_path = Path(__file__).resolve().parents[1] / "static" / "debug_input.png"
    Image.fromarray((arr.reshape(28, 28) * 255).astype("uint8")).resize((200, 200), Image.NEAREST).save(str(debug_path))
    log.info("DEBUG input saved → open http://localhost:8000/static/debug_input.png")

    return arr.reshape(1, 28, 28, 1)


class ClassifyBody(BaseModel):
    cutoutUrl: Optional[str] = None
    imageDataUrl: Optional[str] = None
    studentId: Optional[str] = None
    topic: Optional[str] = "animals"


@router.post("/classify")
async def classify(body: ClassifyBody):
    if not body.cutoutUrl:
        raise HTTPException(status_code=422, detail="cutoutUrl is required")

    topic = body.topic if body.topic in TOPIC_CONFIG else "animals"
    cfg = TOPIC_CONFIG[topic]
    class_names: list[str] = cfg["classes"]
    anim_map: dict[str, str] = cfg["anim"]

    # Rewrite public tunnel URL → localhost so the ml-api doesn't round-trip
    # through Cloudflare to fetch its own static files.
    cutout_url = body.cutoutUrl
    public_base = os.getenv("MODEL_ASSET_BASE_URL", "").rstrip("/")
    if public_base and cutout_url.startswith(public_base):
        port = os.getenv("ML_API_PORT", "8000")
        cutout_url = "http://localhost:" + port + "/static" + cutout_url[len(public_base):]

    try:
        async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
            resp = await client.get(cutout_url)
            resp.raise_for_status()
            img_bytes = resp.content
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch cutout: {exc}") from exc

    try:
        arr = _preprocess(img_bytes)
        probs: np.ndarray = _get_model(topic).predict(arr, verbose=0)[0]
    except Exception as exc:
        log.exception("Inference failed")
        raise HTTPException(status_code=500, detail=f"Inference error: {exc}") from exc

    ranked = np.argsort(probs)[::-1]
    label = class_names[int(ranked[0])]
    confidence = float(probs[int(ranked[0])])
    candidates = [class_names[int(i)] for i in ranked[1:]]

    all_probs = {class_names[int(i)]: round(float(probs[int(i)]), 3) for i in range(len(class_names))}
    log.info("topic=%s probs=%s  winner=%s (%.0f%%)", topic, all_probs, label, confidence * 100)

    return {
        "ok": True,
        "label": label,
        "confidence": round(confidence, 3),
        "suggestedAnimation": anim_map.get(label, "idle"),
        "candidates": candidates,
    }

"""POST /v1/classify

Runs the student's cutout through the correct QuickDraw CNN based on the room topic:
  - topic="animals"  → image_classifier_fyp.keras    (butterfly, cat, dog, fish)
  - topic="nature"   → image_classifier_nature_colored.keras  (cloud, flower, rain, rainbow, sun, tree)
"""
from __future__ import annotations

import io
import logging
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
        "path": _MODELS_DIR / "image_classifier_nature_colored.keras",
        "classes": ["cloud", "flower", "rain", "rainbow", "sun", "tree"],
        "anim": {"cloud": "idle", "flower": "idle", "rain": "idle", "rainbow": "idle", "sun": "idle", "tree": "idle"},
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

    # If the drawing is heavily filled (coloured regions, not just outlines),
    # extract the outline so it matches QuickDraw's line-art training style.
    # A filled orange flower at 28x28 looks like a solid blob — the outline
    # looks like a flower. Threshold >35% fill = treat as filled drawing.
    ink_ratio = ink_crop.mean()
    log.info("ink fill ratio=%.2f", ink_ratio)
    if ink_ratio > 0.35:
        from scipy.ndimage import binary_erosion, binary_closing
        bbox_size = max(ink_crop.shape)
        # Step 1: close internal gaps (scribble lines inside a fill leave dark holes
        # that create noisy patterns at 28x28 — closing fills them into a clean solid shape)
        close_depth = max(5, bbox_size // 20)
        cleaned = binary_closing(ink_crop, iterations=close_depth)
        # Step 2: extract outline from the clean solid shape
        erosion_depth = max(3, bbox_size // 12)
        eroded = binary_erosion(cleaned, iterations=erosion_depth)
        outline = cleaned & ~eroded
        if outline.any():
            ink_crop = outline
            log.info("filled drawing — closed+outlined (close=%d erode=%d)", close_depth, erosion_depth)

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

    try:
        async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
            resp = await client.get(body.cutoutUrl)
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

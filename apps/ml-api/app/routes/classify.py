"""POST /v1/classify

Runs the student's cutout through image_classifier.keras (28×28 greyscale CNN,
4-class softmax). Classifier classes are temporarily proxied to available 3D
model labels until matching GLB assets are ready.
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

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "image_classifier.keras"

# ── Class order must match training label indices 0-3 ─────────────────────────
CLASSIFIER_LABELS: list[str] = ["apple", "banana", "aeroplane", "axe"]

# ── Temporary proxy: swap out entries once matching GLB assets exist ───────────
PROXY_TO_3D: dict[str, str] = {
    "apple":     "cat",
    "banana":    "dog",
    "aeroplane": "bird",
    "axe":       "robot",
}

ANIM_MAP: dict[str, str] = {
    "cat": "walk", "dog": "run", "dragon": "jump", "robot": "walk",
    "dinosaur": "run", "bird": "fly", "fish": "swim",
}

# Lazy-loaded singleton — model loads on first request, stays in memory after.
_model = None


def _get_model():
    global _model
    if _model is None:
        os.environ.setdefault("KERAS_BACKEND", "numpy")
        import keras  # noqa: PLC0415 — deferred so KERAS_BACKEND is set first
        log.info("Loading classifier from %s", MODEL_PATH)
        _model = keras.models.load_model(str(MODEL_PATH))
        log.info("Classifier ready")
    return _model


def _preprocess(img_bytes: bytes) -> np.ndarray:
    """Composite cutout on white, resize to 28×28 greyscale float32 [0,1].

    If your training data used white strokes on a black background (Quick Draw style),
    set CLASSIFIER_INVERT=true in your .env to flip the image before inference.
    """
    img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.paste(img, mask=img.split()[3])
    grey = bg.convert("L").resize((28, 28), Image.LANCZOS)
    arr = np.array(grey, dtype="float32").reshape(1, 28, 28, 1) / 255.0
    if os.getenv("CLASSIFIER_INVERT", "false").lower() == "true":
        arr = 1.0 - arr
    return arr


class ClassifyBody(BaseModel):
    cutoutUrl: Optional[str] = None
    imageDataUrl: Optional[str] = None
    studentId: Optional[str] = None


@router.post("/classify")
async def classify(body: ClassifyBody):
    if not body.cutoutUrl:
        raise HTTPException(status_code=422, detail="cutoutUrl is required")

    # Fetch the cutout image from the ML API's own /static endpoint.
    try:
        async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
            resp = await client.get(body.cutoutUrl)
            resp.raise_for_status()
            img_bytes = resp.content
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch cutout: {exc}") from exc

    # Preprocess and run inference.
    try:
        arr = _preprocess(img_bytes)
        probs: np.ndarray = _get_model().predict(arr, verbose=0)[0]
    except Exception as exc:
        log.exception("Inference failed")
        raise HTTPException(status_code=500, detail=f"Inference error: {exc}") from exc

    # Rank predictions and proxy to available 3D model labels.
    ranked = np.argsort(probs)[::-1]
    predicted_class = CLASSIFIER_LABELS[int(ranked[0])]
    confidence = float(probs[int(ranked[0])])
    label = PROXY_TO_3D.get(predicted_class, "cat")
    candidates = [PROXY_TO_3D.get(CLASSIFIER_LABELS[int(i)], "cat") for i in ranked[1:]]

    all_probs = {CLASSIFIER_LABELS[int(i)]: round(float(probs[int(i)]), 3) for i in range(len(CLASSIFIER_LABELS))}
    log.info("classify probs: %s → winner: %s (%.2f) → 3D label '%s'", all_probs, predicted_class, confidence, label)

    return {
        "ok": True,
        "label": label,
        "confidence": round(confidence, 3),
        "suggestedAnimation": ANIM_MAP.get(label, "idle"),
        "candidates": candidates,
    }

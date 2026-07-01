"""POST /v1/classify

CNN classifier using the QuickDraw-trained Keras model (image_classifier.keras).
Accepts a cutoutUrl (saved PNG path) or imageDataUrl (base64 data URL).
Returns label, confidence, suggestedAnimation, and top candidates.
"""
from __future__ import annotations

import base64
import io
import re
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from PIL import Image
from pydantic import BaseModel

router = APIRouter()

CLASS_NAMES = ["airplane", "apple", "axe", "banana"]

ANIMATION_MAP = {
    "airplane": "fly",
    "apple": "idle",
    "axe": "idle",
    "banana": "idle",
}

MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "image_classifier.keras"
CUTOUT_DIR = Path(__file__).resolve().parents[1] / "static" / "cutouts"

_model = None


def _get_model():
    global _model
    if _model is None:
        import tensorflow as tf
        _model = tf.keras.models.load_model(str(MODEL_PATH))
    return _model


def _preprocess(image_bytes: bytes) -> np.ndarray:
    """Convert a PNG cutout to a (1, 28, 28, 1) float32 array matching QuickDraw training format."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    # Composite transparent areas onto white so strokes remain dark
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.paste(img, mask=img.split()[3])
    gray = bg.convert("L").resize((28, 28), Image.LANCZOS)
    arr = np.array(gray, dtype=np.float32) / 255.0
    # QuickDraw training format: ink=1.0, background=0.0 — canvas is the opposite
    arr = 1.0 - arr
    return arr.reshape(1, 28, 28, 1)


class ClassifyBody(BaseModel):
    cutoutUrl: Optional[str] = None
    imageDataUrl: Optional[str] = None
    studentId: Optional[str] = None


@router.post("/classify")
def classify(body: ClassifyBody):
    image_bytes: Optional[bytes] = None

    if body.cutoutUrl:
        match = re.search(r"cutouts/([^/?#]+\.png)", body.cutoutUrl)
        if match:
            fpath = CUTOUT_DIR / match.group(1)
            if fpath.exists():
                image_bytes = fpath.read_bytes()

    if image_bytes is None and body.imageDataUrl:
        if "," in body.imageDataUrl:
            _, b64 = body.imageDataUrl.split(",", 1)
            try:
                image_bytes = base64.b64decode(b64)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")

    if image_bytes is None:
        raise HTTPException(
            status_code=400,
            detail="Could not load image — provide a valid cutoutUrl or imageDataUrl",
        )

    try:
        model = _get_model()
        arr = _preprocess(image_bytes)
        predictions = model.predict(arr, verbose=0)
        sorted_indices = np.argsort(predictions[0])[::-1]
        class_index = int(sorted_indices[0])
        confidence = float(predictions[0][class_index])
        label = CLASS_NAMES[class_index]
        candidates = [CLASS_NAMES[i] for i in sorted_indices[:3]]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Classification failed: {e}")

    return {
        "ok": True,
        "label": label,
        "confidence": round(confidence, 3),
        "suggestedAnimation": ANIMATION_MAP.get(label, "idle"),
        "candidates": candidates,
    }

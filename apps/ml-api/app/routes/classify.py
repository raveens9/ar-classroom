"""POST /v1/classify

Dummy classifier that picks a random label from a small zoo. Keeps the UI flow
end-to-end while a real model (CLIP / MobileNet / whatever) gets wired later.
"""
from __future__ import annotations

import random
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

LABELS: list[str] = [
    "dog", "cat", "dragon", "robot", "dinosaur", "bird", "fish",
    "car", "airplane", "tree", "house", "rocket",
]


class ClassifyBody(BaseModel):
    cutoutUrl: Optional[str] = None
    imageDataUrl: Optional[str] = None
    studentId: Optional[str] = None


@router.post("/classify")
def classify(body: ClassifyBody):
    label = random.choice(LABELS)
    # Deterministic-ish confidence in [0.55, 0.95].
    confidence = round(random.uniform(0.55, 0.95), 3)
    # Suggest a default animation based on label so teacher sees a sane preview.
    anim_map = {
        "dog": "run", "cat": "walk", "dragon": "jump", "robot": "walk",
        "dinosaur": "run", "bird": "fly", "fish": "swim",
    }
    return {
        "ok": True,
        "label": label,
        "confidence": confidence,
        "suggestedAnimation": anim_map.get(label, "idle"),
        "candidates": random.sample(LABELS, k=3),
    }

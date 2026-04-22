"""POST /v1/prepare-texture-model

Takes a (classified) subject cutout + a base model reference and returns a "prepared"
bundle: the model URL + a texture URL derived from the cutout. The frontend loads the
model with its original materials/animations — the texture is available for optional
overlay but not forced (per AR spec).

Model files live in apps/web/public/ (served by the web app). The ML API returns URLs
pointing at that origin so assets don't have to be duplicated.
"""
from __future__ import annotations

import random
import uuid
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.assets import public_model_url, static_url

router = APIRouter()

STATIC_ROOT = Path(__file__).resolve().parents[1] / "static"
TEXTURES_DIR = STATIC_ROOT / "textures"
TEXTURES_DIR.mkdir(parents=True, exist_ok=True)

# Paths are relative to the web app's /public root (apps/web/public/<path>).
# Animated assets are preferred so users see motion in AR.
MODEL_REGISTRY: dict[str, str] = {
    # Animated animals — these are what we actually have.
    "cat": "an_animated_cat.glb",
    "dog": "dog/source/dog.glb",
    # Classifier can also return these labels; map them to animated fallbacks
    # so testing produces a visible result every time.
    "dragon": "dog/source/dog.glb",
    "dinosaur": "dog/source/dog.glb",
    "robot": "an_animated_cat.glb",
    "bird": "an_animated_cat.glb",
    "fish": "an_animated_cat.glb",
    # Non-animal labels → fall through to a letter (picked randomly at request time).
    # Handled below in resolve_model_path().
}

LETTERS: list[str] = (
    ["Letter_A.glb", "Letter_B.glb", "Letter_C.glb"]
    + [f"{c}.glb" for c in "DEFGHIJKLMNOPQRSTUVWXYZ"]
)


def resolve_model_path(label: str) -> str:
    """Map a classifier label to a real file under apps/web/public."""
    if label in MODEL_REGISTRY:
        return MODEL_REGISTRY[label]
    # Unknown labels (car, airplane, tree, house, rocket, …) — pick a random letter
    # so the teacher still sees something on publish.
    return random.choice(LETTERS)


class PrepareBody(BaseModel):
    cutoutUrl: str
    label: str
    studentId: Optional[str] = None
    animationName: Optional[str] = None


async def _mirror_cutout_as_texture(cutout_url: str) -> str:
    """Download the cutout and store as a texture file. Returns texture URL."""
    tex_id = uuid.uuid4().hex
    tex_path = TEXTURES_DIR / f"{tex_id}.png"
    try:
        async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
            r = await client.get(cutout_url)
            r.raise_for_status()
            tex_path.write_bytes(r.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch cutout: {e}")
    return static_url(f"textures/{tex_path.name}")


@router.post("/prepare-texture-model")
async def prepare_texture_model(body: PrepareBody):
    model_rel = resolve_model_path(body.label)
    texture_url = await _mirror_cutout_as_texture(body.cutoutUrl)
    return {
        "ok": True,
        "modelUrl": public_model_url(model_rel),
        "textureUrl": texture_url,
        "label": body.label,
        "animationName": body.animationName,
        "studentId": body.studentId,
        "modelFile": model_rel,
        # Explicit: client SHOULD NOT force this texture on top of original materials.
        "textureUsageHint": "overlay-optional",
    }

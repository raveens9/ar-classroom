"""POST /v1/prepare-texture-model

Takes a (classified) subject cutout + a base model reference and returns a "prepared"
bundle: the model URL + a texture URL derived from the cutout. The frontend loads the
model with its original materials/animations — the texture is available for optional
overlay but not forced (per AR spec).

Model files live in apps/web/public/ (served by the web app). The ML API returns URLs
pointing at that origin so assets don't have to be duplicated.
"""
from __future__ import annotations

import os
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
MODEL_REGISTRY: dict[str, str | list[str]] = {
    # Animals
    "butterfly": [
        "Animals/butterfly/animated_flying_fluttering_butterfly_loop.glb",
        "Animals/butterfly/butterfly.glb",
        "Animals/butterfly/ulysses_butterfly.glb",
    ],
    "cat":       "Animals/cat/cat.glb",
    "dog":       "Animals/dog/dog.glb",
    "dragon":    "Animals/dog/dog.glb",
    "dinosaur":  [
        "Animals/dinosaur/dinosaur.glb",
        "Animals/dinosaur/raptor_dinosaur_indoraptor.glb",
    ],
    "robot":     "Animals/cat/cat.glb",
    "bird":      [
        "Animals/butterfly/animated_flying_fluttering_butterfly_loop.glb",
        "Animals/butterfly/butterfly.glb",
        "Animals/butterfly/ulysses_butterfly.glb",
    ],
    "fish":      "Animals/fish/fish.glb",
    # Nature
    "cloud":     "Nature/cloud_animation.glb",
    "flower":    [
        "Nature/blue_flower_animated.glb",
        "Nature/daisy_flower.glb",
        "Nature/flower_animated.glb",
        "Nature/flower_lowpoly.glb",
    ],
    "rain":      "Nature/rain_2.glb",
    "rainbow":   "Nature/rainbow.glb",
    "sun":       "Nature/cloud__sun_lowpoly.glb",
    "tree":      [
        "Nature/tree_animate.glb",
        "Nature/tree_oak.glb",
    ],
    # Letters A–Z
    **{chr(c): f"Alphabet/{chr(c)}.glb" for c in range(ord("A"), ord("Z") + 1)},
    # Numbers 0–9
    **{str(i): f"Numbers/{i}.glb" for i in range(10)},
    # Vehicles
    "car":       "Vehicles/car.glb",
    "airplane":  "Vehicles/airplane.glb",
    "sailboat":  "Vehicles/rowing_boat.glb",
    "van":       "Vehicles/van.glb",
    # Vegetables
    "carrot":    "Vegetables/carrot.glb",
    "broccoli":  "Vegetables/broccoli.glb",
    "corn":      "Vegetables/corn.glb",
    "mushroom":  "Vegetables/mushroom.glb",
    "pumpkin":   "Vegetables/pumpkin.glb",
}

LETTERS: list[str] = [f"Alphabet/{c}.glb" for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]


def resolve_model_path(label: str) -> str:
    """Map a classifier label to a real file under apps/web/public."""
    entry = MODEL_REGISTRY.get(label)
    if isinstance(entry, list):
        return random.choice(entry)
    if entry:
        return entry
    return random.choice(LETTERS)


class PrepareBody(BaseModel):
    cutoutUrl: str
    label: str
    studentId: Optional[str] = None
    animationName: Optional[str] = None


def _localise_cutout_url(url: str) -> str:
    public_base = os.getenv("MODEL_ASSET_BASE_URL", "").rstrip("/")
    if public_base and url.startswith(public_base):
        port = os.getenv("ML_API_PORT", "8000")
        return "http://localhost:" + port + "/static" + url[len(public_base):]
    return url


async def _mirror_cutout_as_texture(cutout_url: str) -> str:
    """Download the cutout and store as a texture file. Returns texture URL."""
    tex_id = uuid.uuid4().hex
    tex_path = TEXTURES_DIR / f"{tex_id}.png"
    try:
        async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
            r = await client.get(_localise_cutout_url(cutout_url))
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

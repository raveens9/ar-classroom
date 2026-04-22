"""POST /v1/remove-background

Accepts an image (PNG dataURL or multipart), returns a cutout URL (transparent background).
The stub here thresholds by alpha + color — good enough to unblock the UI flow; swap for
rembg / u2net / modnet in production.
"""
from __future__ import annotations

import base64
import io
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel

from app.assets import static_url

router = APIRouter()

CUTOUT_DIR = Path(__file__).resolve().parents[1] / "static" / "cutouts"
CUTOUT_DIR.mkdir(parents=True, exist_ok=True)


class RemoveBgJSON(BaseModel):
    imageDataUrl: str
    studentId: Optional[str] = None


def _decode_dataurl(data_url: str) -> bytes:
    if "," not in data_url:
        raise HTTPException(status_code=400, detail="imageDataUrl must be a data URL")
    _, b64 = data_url.split(",", 1)
    try:
        return base64.b64decode(b64)
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")


def _cutout(image_bytes: bytes) -> bytes:
    """Treat near-white pixels as background → alpha 0. Dumb but deterministic."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if r > 240 and g > 240 and b > 240:
                pixels[x, y] = (r, g, b, 0)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


@router.post("/remove-background")
async def remove_background(
    imageDataUrl: Optional[str] = Form(default=None),
    studentId: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
):
    if file is not None:
        image_bytes = await file.read()
    elif imageDataUrl:
        image_bytes = _decode_dataurl(imageDataUrl)
    else:
        raise HTTPException(status_code=400, detail="Provide file or imageDataUrl")

    cut_id = uuid.uuid4().hex
    fname = f"{cut_id}.png"
    fpath = CUTOUT_DIR / fname
    fpath.write_bytes(_cutout(image_bytes))

    return {
        "ok": True,
        "cutoutId": cut_id,
        "cutoutUrl": static_url(f"cutouts/{fname}"),
        "studentId": studentId,
    }


@router.post("/remove-background.json")
async def remove_background_json(body: RemoveBgJSON):
    image_bytes = _decode_dataurl(body.imageDataUrl)
    cut_id = uuid.uuid4().hex
    fname = f"{cut_id}.png"
    fpath = CUTOUT_DIR / fname
    fpath.write_bytes(_cutout(image_bytes))
    return {
        "ok": True,
        "cutoutId": cut_id,
        "cutoutUrl": static_url(f"cutouts/{fname}"),
        "studentId": body.studentId,
    }

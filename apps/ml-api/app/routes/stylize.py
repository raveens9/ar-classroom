"""Stylize proxy — downloads a GLB + drawing by URL, forwards to the
style-transfer service, saves the result, and returns a URL.

POST /v1/stylize
  { model_url, drawing_url?, style_choice, intensity?, tier? }
  -> { ok, styled_url }
"""
from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.assets import asset_base

log = logging.getLogger("ml-api.stylize")

router = APIRouter()

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
STYLED_DIR = STATIC_DIR / "styled"

# Internal URL of the style-transfer service. No TLS needed for service-to-service.
_STYLE_TRANSFER_URL = os.getenv("STYLE_TRANSFER_URL", "http://localhost:8001").rstrip("/")


class StylizeBody(BaseModel):
    model_url: str
    drawing_url: str | None = None
    style_choice: str = "child_colors"
    intensity: float = 0.8
    tier: int = 12


class StylizeResponse(BaseModel):
    ok: bool
    styled_url: str


@router.post("/stylize", response_model=StylizeResponse)
async def stylize(body: StylizeBody) -> StylizeResponse:
    """Download a GLB + drawing by URL, run style transfer, return a URL to the result."""
    STYLED_DIR.mkdir(parents=True, exist_ok=True)

    # Use verify=False because dev TLS certs are self-signed.
    async with httpx.AsyncClient(verify=False, timeout=120.0) as client:
        # Fetch the base GLB model.
        try:
            glb_resp = await client.get(body.model_url)
            glb_resp.raise_for_status()
            glb_bytes = glb_resp.content
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to fetch model: {exc}") from exc

        # Fetch drawing if provided.
        drawing_bytes: bytes | None = None
        if body.drawing_url:
            try:
                draw_resp = await client.get(body.drawing_url)
                draw_resp.raise_for_status()
                drawing_bytes = draw_resp.content
            except Exception as exc:
                log.warning("Could not fetch drawing (%s): %s — proceeding without it", body.drawing_url, exc)

        # Build multipart payload for the style-transfer service.
        # If no drawing, fall back to neural-only (tier 2) so the palette step is skipped.
        effective_tier = body.tier if drawing_bytes else 2
        files: dict = {
            "base_model": ("model.glb", glb_bytes, "application/octet-stream"),
        }
        if drawing_bytes:
            files["drawing"] = ("drawing.png", drawing_bytes, "image/png")

        data = {
            "style_choice": body.style_choice,
            "intensity":    str(body.intensity),
            "tier":         str(effective_tier),
        }

        try:
            st_resp = await client.post(
                f"{_STYLE_TRANSFER_URL}/stylize",
                files=files,
                data=data,
            )
            st_resp.raise_for_status()
            styled_bytes = st_resp.content
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:400] if exc.response else str(exc)
            raise HTTPException(status_code=502, detail=f"Style transfer failed: {detail}") from exc
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Style transfer service unreachable: {exc}") from exc

    # Persist the styled GLB so the web app can load it as a URL.
    out_id = str(uuid.uuid4())
    out_path = STYLED_DIR / f"{out_id}.glb"
    out_path.write_bytes(styled_bytes)

    styled_url = f"{asset_base()}/styled/{out_id}.glb"
    log.info("Styled model saved → %s", styled_url)
    return StylizeResponse(ok=True, styled_url=styled_url)

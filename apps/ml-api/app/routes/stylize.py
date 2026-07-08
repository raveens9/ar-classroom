"""Stylize proxy — downloads a GLB + drawing by URL, forwards to the
style-transfer service, saves the result, and returns a URL.

POST /v1/stylize
  { model_url, drawing_url?, style_choice, intensity?, tier? }
  -> { ok, styled_url }
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
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

# Ceiling on total time spent waiting for a queued job — this is a genuine
# "give up" limit, not an artifact of one blocking call, since the job queue
# means concurrent requests no longer serialize behind a fully-blocked
# connection. Polling itself is cheap and near-instant per request.
_JOB_POLL_INTERVAL_S = 1.0
_JOB_MAX_WAIT_S = 300.0


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
    async with httpx.AsyncClient(verify=False, timeout=30.0) as client:
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

        # Submit to the style-transfer service's job queue rather than making
        # one long blocking call — under concurrent load (multiple students
        # styling at once) a single blocking call queues behind whichever
        # request the service happens to be running and can exceed a fixed
        # timeout even though nothing is actually wrong. The job queue
        # accepts every submission instantly; we then poll for completion.
        try:
            submit_resp = await client.post(
                f"{_STYLE_TRANSFER_URL}/stylize/jobs",
                files=files,
                data=data,
            )
            submit_resp.raise_for_status()
            job_id = submit_resp.json()["job_id"]
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:400] if exc.response else str(exc)
            raise HTTPException(status_code=502, detail=f"Style transfer failed: {detail}") from exc
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Style transfer service unreachable: {exc}") from exc

        deadline = time.monotonic() + _JOB_MAX_WAIT_S
        while True:
            try:
                status_resp = await client.get(f"{_STYLE_TRANSFER_URL}/stylize/jobs/{job_id}")
                status_resp.raise_for_status()
                status = status_resp.json()
            except Exception as exc:
                raise HTTPException(status_code=503, detail=f"Style transfer service unreachable: {exc}") from exc

            if status["status"] == "done":
                break
            if status["status"] == "error":
                raise HTTPException(status_code=502, detail=f"Style transfer failed: {status.get('error')}")
            if time.monotonic() > deadline:
                raise HTTPException(
                    status_code=504,
                    detail=f"Style transfer job {job_id} timed out waiting in queue.",
                )
            await asyncio.sleep(_JOB_POLL_INTERVAL_S)

        try:
            result_resp = await client.get(f"{_STYLE_TRANSFER_URL}/stylize/jobs/{job_id}/result")
            result_resp.raise_for_status()
            styled_bytes = result_resp.content
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Style transfer service unreachable: {exc}") from exc

    # Persist the styled GLB so the web app can load it as a URL.
    out_id = str(uuid.uuid4())
    out_path = STYLED_DIR / f"{out_id}.glb"
    out_path.write_bytes(styled_bytes)

    styled_url = f"{asset_base()}/styled/{out_id}.glb"
    log.info("Styled model saved → %s", styled_url)
    return StylizeResponse(ok=True, styled_url=styled_url)

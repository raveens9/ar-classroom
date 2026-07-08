"""Style-transfer endpoints.

POST /stylize          — upload a .glb file + drawing → styled .glb
POST /stylize/by-name  — pick a model from the catalog by name → styled .glb
POST /stylize/by-class — pass classifier output (class name) + drawing → styled .glb
POST /stylize/multi    — sequential style pipeline → one final .glb
POST /stylize/preview  — extract palette colours from a drawing
"""

from __future__ import annotations

import pathlib
import tempfile
import time
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from backend.config import STYLE_CATALOGUE, GLB_DIR, resolve_model_path, resolve_class_name

router = APIRouter()

_VALID_TIERS = {1, 2, 12}
_TIER_LABELS = {1: "palette", 2: "neural", 12: "chained"}


# ── Shared helpers ────────────────────────────────────────────────────────────

def _run_pipeline(
    glb_path: pathlib.Path,
    drawing_path: pathlib.Path,
    style_choice: str,
    intensity: float,
    tier: int,
    output_path: pathlib.Path,
) -> float:
    """Call the style_transfer pipeline and return elapsed seconds."""
    from style_transfer.pipeline import stylize

    start = time.perf_counter()
    stylize(
        base_model_path=glb_path,
        drawing_path=drawing_path,
        style_choice=style_choice,
        intensity=intensity,
        output_path=output_path,
        tier=tier,
    )
    return round(time.perf_counter() - start, 3)


def _validate_params(style_choice: str, intensity: float, tier: int) -> None:
    if style_choice not in STYLE_CATALOGUE:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown style_choice '{style_choice}'. "
                   "Call GET /styles to see all valid options.",
        )
    if not (0.0 <= intensity <= 1.0):
        raise HTTPException(status_code=422, detail="intensity must be between 0.0 and 1.0.")
    if tier not in _VALID_TIERS:
        raise HTTPException(
            status_code=422,
            detail=f"tier must be one of {sorted(_VALID_TIERS)}. "
                   "Use 1 (palette), 2 (neural), or 12 (chained Tier1->Tier2).",
        )
    meta = STYLE_CATALOGUE[style_choice]
    if tier not in meta["tiers_supported"]:
        raise HTTPException(
            status_code=422,
            detail=f"Style '{style_choice}' does not support tier {tier}. "
                   f"Supported tiers: {meta['tiers_supported']}.",
        )


def _build_response(
    styled_bytes: bytes,
    style_label: str,
    tier: int,
    elapsed: float,
    extra_headers: dict | None = None,
) -> Response:
    headers = {
        "Content-Disposition": "attachment; filename=styled_model.glb",
        "X-Style-Applied":     style_label,
        "X-Tier-Used":         f"{tier} ({_TIER_LABELS.get(tier, str(tier))})",
        "X-Processing-Time-S": str(elapsed),
    }
    if extra_headers:
        headers.update(extra_headers)
    return Response(content=styled_bytes, media_type="application/octet-stream", headers=headers)


# ── POST /stylize ─────────────────────────────────────────────────────────────

@router.post("/stylize", summary="Style transfer — upload your own .glb")
async def stylize_upload(
    base_model:   Annotated[UploadFile, File(description="Base .glb 3D model file")],
    drawing:      Annotated[UploadFile, File(description="Child's drawing (PNG or JPEG)")],
    style_choice: Annotated[str,   Form(description="Style preset name. Call GET /styles for options.")] = "child_colors",
    intensity:    Annotated[float, Form(description="Style blend strength 0.0 -> 1.0")] = 0.8,
    tier:         Annotated[int,   Form(description="1=palette, 2=neural, 12=chained")] = 1,
) -> Response:
    """Apply style transfer to an uploaded .glb + drawing. Returns styled .glb."""
    _validate_params(style_choice, intensity, tier)

    glb_bytes     = await base_model.read()
    drawing_bytes = await drawing.read()
    if not glb_bytes:
        raise HTTPException(status_code=422, detail="base_model file is empty.")
    if not drawing_bytes:
        raise HTTPException(status_code=422, detail="drawing file is empty.")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            glb_path  = tmp / "input.glb"
            draw_path = tmp / "drawing.png"
            out_path  = tmp / "styled.glb"
            glb_path.write_bytes(glb_bytes)
            draw_path.write_bytes(drawing_bytes)
            elapsed = _run_pipeline(glb_path, draw_path, style_choice, intensity, tier, out_path)
            return _build_response(out_path.read_bytes(), style_choice, tier, elapsed)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {exc}") from exc


# ── POST /stylize/by-name ─────────────────────────────────────────────────────

@router.post("/stylize/by-name", summary="Style transfer — pick model from catalog by name")
async def stylize_by_name(
    drawing:        Annotated[UploadFile, File(description="Child's drawing (PNG or JPEG)")],
    model_category: Annotated[str,   Form(description="Catalog category, e.g. 'animals'")] = "animals",
    model_name:     Annotated[str,   Form(description="Model key, e.g. 'cat'")] = "cat",
    style_choice:   Annotated[str,   Form(description="Style preset. Call GET /styles.")] = "child_colors",
    intensity:      Annotated[float, Form(description="Style blend strength 0.0 -> 1.0")] = 0.8,
    tier:           Annotated[int,   Form(description="1=palette, 2=neural, 12=chained")] = 1,
) -> Response:
    """Style transfer using a catalog model (category + name). Returns styled .glb."""
    _validate_params(style_choice, intensity, tier)

    glb_path = resolve_model_path(model_category, model_name)
    if glb_path is None:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{model_name}' in category '{model_category}' not found. "
                   "Call GET /models to see available models.",
        )

    drawing_bytes = await drawing.read()
    if not drawing_bytes:
        raise HTTPException(status_code=422, detail="drawing file is empty.")

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            draw_path = tmp / "drawing.png"
            out_path  = tmp / "styled.glb"
            draw_path.write_bytes(drawing_bytes)
            elapsed = _run_pipeline(glb_path, draw_path, style_choice, intensity, tier, out_path)
            return _build_response(out_path.read_bytes(), style_choice, tier, elapsed)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {exc}") from exc


# ── POST /stylize/by-class ────────────────────────────────────────────────────

@router.post("/stylize/by-class", summary="Style transfer — pass classifier output directly")
async def stylize_by_class(
    drawing:      Annotated[UploadFile, File(description="Child's drawing (PNG or JPEG)")],
    class_name:   Annotated[str,   Form(description="Classifier output, e.g. 'cat'")] = "cat",
    style_choice: Annotated[str,   Form(description="Style preset. Call GET /styles.")] = "child_colors",
    intensity:    Annotated[float, Form(description="Style blend strength 0.0 -> 1.0")] = 0.8,
    tier:         Annotated[int,   Form(description="1=palette, 2=neural, 12=chained")] = 1,
) -> Response:
    """Style transfer using classifier output — finds the model automatically.

    The classifier predicts a class name (e.g. 'cat'). Pass it here and the
    backend locates the matching GLB across all catalog categories.

    Call GET /classes to see all supported class names.
    """
    _validate_params(style_choice, intensity, tier)

    drawing_bytes = await drawing.read()
    if not drawing_bytes:
        raise HTTPException(status_code=422, detail="drawing file is empty.")

    result = resolve_class_name(class_name)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No model found for class '{class_name}'. Call GET /classes.",
        )
    category, name, glb_path = result

    try:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            draw_path = tmp / "drawing.png"
            out_path  = tmp / "styled.glb"
            draw_path.write_bytes(drawing_bytes)
            elapsed = _run_pipeline(glb_path, draw_path, style_choice, intensity, tier, out_path)
            return _build_response(
                out_path.read_bytes(), style_choice, tier, elapsed,
                extra_headers={"X-Model-Category": category, "X-Model-Name": name},
            )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {exc}") from exc


# ── POST /stylize/multi ───────────────────────────────────────────────────────

@router.post("/stylize/multi", summary="Sequential style pipeline — one final GLB always returned")
async def stylize_multi(
    class_name: Annotated[str,   Form(description="Classifier output class name, e.g. 'cat'")] = "cat",
    styles:     Annotated[str,   Form(description=(
        "Comma-separated Tier-2 style names applied in order. "
        "Leave empty to apply child-colour matching only (drawing required). "
        "Examples: 'watercolor'  |  'watercolor,cartoon,van_gogh'"
    ))] = "",
    intensity:  Annotated[float, Form(description="Style blend strength 0.0 -> 1.0")] = 0.8,
    drawing:    Annotated[UploadFile | None, File(description=(
        "Child's drawing (PNG or JPEG). "
        "When provided: child colours are applied first, then each style in sequence. "
        "When omitted: styles run directly on the original model (no colour step)."
    ))] = None,
) -> Response:
    """Sequential style pipeline — always returns ONE final GLB.

    Each step takes the previous step's output as its input, so styles build
    on top of each other rather than being applied independently.

    Behaviour by input:

      drawing only (no styles)
        -> child_colors (Tier 1)  ->  1 GLB

      drawing + styles
        -> child_colors (Tier 1)  ->  style1 (Tier 2)  ->  style2 (Tier 2)  ->  1 GLB

      styles only (no drawing)
        -> style1 (Tier 2)  ->  style2 (Tier 2)  ->  1 GLB

    Always returns application/octet-stream (a single .glb file).
    The X-Pipeline response header shows exactly what steps ran.
    """
    if not (0.0 <= intensity <= 1.0):
        raise HTTPException(status_code=422, detail="intensity must be between 0.0 and 1.0.")

    style_list = [s.strip() for s in styles.split(",") if s.strip()]

    for s in style_list:
        if s not in STYLE_CATALOGUE:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown style '{s}'. Call GET /styles for all valid names.",
            )

    # Read drawing bytes (drawing field may be None or empty)
    drawing_bytes: bytes = b""
    if drawing is not None:
        drawing_bytes = await drawing.read()
    has_drawing = bool(drawing_bytes)

    if not has_drawing and not style_list:
        raise HTTPException(
            status_code=422,
            detail="Provide a drawing, at least one style name, or both. Nothing to do.",
        )

    result = resolve_class_name(class_name)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No model found for class '{class_name}'. Call GET /classes.",
        )
    _category, _name, glb_path = result

    total_start = time.perf_counter()

    try:
        with tempfile.TemporaryDirectory() as _tmp:
            tmp = pathlib.Path(_tmp)

            # Drawing path: real file if provided, small white placeholder otherwise
            # (Tier-2 preset styles don't use the drawing image, but the pipeline
            # always expects a valid path)
            draw_path = tmp / "drawing.png"
            if has_drawing:
                draw_path.write_bytes(drawing_bytes)
            else:
                import numpy as np
                from PIL import Image as _PIL
                _PIL.fromarray(
                    np.full((64, 64, 3), 255, dtype=np.uint8)
                ).save(draw_path)

            # Sequential pipeline: each step reads from `current`, writes to `out`
            current = glb_path
            step = 0

            # Step 0 (optional): match child's drawing colours via Tier 1
            if has_drawing:
                step += 1
                out = tmp / f"step{step}_tier1.glb"
                _run_pipeline(current, draw_path, "child_colors", intensity, 1, out)
                current = out

            # Steps 1-N: apply each Tier-2 style in the order given
            for style in style_list:
                step += 1
                out = tmp / f"step{step}_{style}.glb"
                _run_pipeline(current, draw_path, style, intensity, 2, out)
                current = out

            final_bytes = current.read_bytes()

    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {exc}") from exc

    total_elapsed = round(time.perf_counter() - total_start, 3)

    steps_run = (["child_colors"] if has_drawing else []) + style_list
    pipeline_label = " -> ".join(steps_run)

    tier_used = 12 if (has_drawing and style_list) else (1 if has_drawing else 2)

    return _build_response(
        final_bytes,
        pipeline_label,
        tier_used,
        total_elapsed,
        extra_headers={
            "X-Model-Name":     _name,
            "X-Model-Category": _category,
            "X-Pipeline":       pipeline_label,
        },
    )


# ── POST /stylize/preview ─────────────────────────────────────────────────────

@router.post("/stylize/preview", summary="Preview — extract palette colours from drawing")
async def preview_palette(
    drawing: Annotated[UploadFile, File(description="Child's drawing (PNG or JPEG)")],
    k:       Annotated[int, Form(description="Number of dominant colours to extract (2-12)")] = 6,
) -> dict:
    """Extract the dominant colour palette from a child's drawing.

    Useful for displaying a colour preview in the web app before running
    the full style transfer. Returns k dominant RGB colours.
    """
    if not (2 <= k <= 12):
        raise HTTPException(status_code=422, detail="k must be between 2 and 12.")

    drawing_bytes = await drawing.read()
    if not drawing_bytes:
        raise HTTPException(status_code=422, detail="drawing file is empty.")

    try:
        import io as _io
        import numpy as np
        from PIL import Image
        from style_transfer.config import BACKGROUND_DELTA_E_THRESHOLD, DRAWING_BACKGROUND_COLOR
        from style_transfer.palette.extract import palette_from_image

        img = np.array(Image.open(_io.BytesIO(drawing_bytes)).convert("RGB"), dtype=np.uint8)
        palette = palette_from_image(
            img, k=k,
            background_color=DRAWING_BACKGROUND_COLOR,
            background_threshold=BACKGROUND_DELTA_E_THRESHOLD,
        )
        colours = [
            {"r": int(c[0] * 255), "g": int(c[1] * 255), "b": int(c[2] * 255)}
            for c in palette
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Palette extraction error: {exc}") from exc

    return {"k": k, "colours": colours}

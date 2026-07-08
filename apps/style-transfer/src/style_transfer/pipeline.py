"""Top-level pipeline: drawing + base .glb + style_choice → styled .glb.

Orchestrates the three tiers:
  Tier 1 — palette transfer (always available, used as fallback)
  Tier 2 — neural texture-space NST via AdaIN / feed-forward
  Tier 3 — multi-view render-and-bake (Colab only, stretch goal)
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Literal

from style_transfer.config import DEFAULT_INTENSITY, OUTPUTS_DIR, VALID_STYLE_CHOICES

StyleChoice = Literal[
    "child_colors",
    # Feed-forward trained presets
    "watercolor", "crayon", "oil_painting", "van_gogh", "impressionism",
    "expressionism", "pastel", "charcoal", "ink_wash", "pointillism",
    "ukiyo_e", "abstract_kandinsky", "mosaic", "graffiti", "marble",
    # Cartoon-family (computational)
    "cartoon", "anime", "cel_shading",
    # Algorithmic filter effects
    "pixel_art", "low_poly", "sepia", "vaporwave", "cyberpunk_neon",
]


def stylize(
    base_model_path: str | Path,
    drawing_path: str | Path,
    style_choice: StyleChoice = "child_colors",
    intensity: float = DEFAULT_INTENSITY,
    output_path: str | Path | None = None,
    tier: int = 1,
) -> dict:
    """Apply style transfer to a .glb model guided by a child's drawing.

    Args:
        base_model_path: Path to the input .glb file.
        drawing_path: Path to the child's drawing (PNG/JPEG).
        style_choice: One of VALID_STYLE_CHOICES.
        intensity: Blend strength, 0.0–1.0.
        output_path: Where to write the styled .glb. Defaults to OUTPUTS_DIR.
        tier: 1 = palette, 2 = neural NST, 3 = render-and-bake (Colab).

    Returns:
        dict with keys: output_path, style_applied, processing_time_s.
    """
    # TODO: implement full pipeline dispatch across tiers
    start = time.perf_counter()

    base_model_path = Path(base_model_path)
    drawing_path = Path(drawing_path)

    if style_choice not in VALID_STYLE_CHOICES:
        raise ValueError(f"style_choice must be one of {VALID_STYLE_CHOICES}")
    if not (0.0 <= intensity <= 1.0):
        raise ValueError("intensity must be between 0.0 and 1.0")

    if output_path is None:
        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        output_path = OUTPUTS_DIR / f"{base_model_path.stem}_{style_choice}.glb"
    output_path = Path(output_path)

    if tier == 1:
        styled_bytes = _run_tier1(base_model_path, drawing_path, style_choice, intensity)
    elif tier == 2:
        styled_bytes = _run_tier2(base_model_path, drawing_path, style_choice, intensity)
    elif tier == 3:
        styled_bytes = _run_tier3(base_model_path, drawing_path, style_choice, intensity)
    elif tier == 12:
        styled_bytes = _run_chained(base_model_path, drawing_path, style_choice, intensity)
    else:
        raise ValueError("tier must be 1, 2, 3, or 12 (chained Tier1→Tier2)")

    output_path.write_bytes(styled_bytes)
    elapsed = time.perf_counter() - start

    return {
        "output_path": str(output_path),
        "style_applied": style_choice,
        "processing_time_s": round(elapsed, 3),
    }


def _run_tier1(
    base_model_path: Path,
    drawing_path: Path,
    style_choice: StyleChoice,
    intensity: float,
) -> bytes:
    """Tier 1: colour transfer — remap texture colours to match the child's drawing.

    Uses histogram matching (skimage.exposure.match_histograms) to transfer the
    drawing's full colour distribution to each texture. Falls back to palette
    recolor for flat (no-texture) materials.
    """
    import io as _io
    import numpy as np
    from PIL import Image as _Image
    from style_transfer.config import (
        BACKGROUND_DELTA_E_THRESHOLD, DEFAULT_PALETTE_K, DRAWING_BACKGROUND_COLOR,
    )
    from style_transfer.io.glb_loader import load_glb, extract_textures
    from style_transfer.io.glb_writer import inject_textures, update_material_colors
    from style_transfer.palette.extract import extract_palette
    from style_transfer.palette.recolor import (
        recolor_asset, recolor_texture_histogram, recolor_flat_material
    )

    asset = load_glb(base_model_path)
    textures = extract_textures(asset)

    drawing = np.array(_Image.open(drawing_path).convert("RGB"), dtype=np.uint8)

    if textures:
        # Histogram match each texture to the drawing
        styled_textures = {
            idx: recolor_texture_histogram(
                tex, drawing, intensity=intensity,
                background_color=DRAWING_BACKGROUND_COLOR,
                background_threshold=BACKGROUND_DELTA_E_THRESHOLD,
            )
            for idx, tex in textures.items()
        }
        styled_asset = inject_textures(asset, styled_textures)

        # Also recolor any flat materials using palette fallback
        palette = extract_palette(
            str(drawing_path), k=DEFAULT_PALETTE_K,
            background_color=DRAWING_BACKGROUND_COLOR,
            background_threshold=BACKGROUND_DELTA_E_THRESHOLD,
        )
        from style_transfer.io.glb_loader import MaterialType
        flat_colors = {
            m.index: recolor_flat_material(m.base_color_factor, palette, intensity)
            for m in asset.material_infos
            if m.mat_type == MaterialType.FLAT
        }
        if flat_colors:
            styled_asset = update_material_colors(styled_asset, flat_colors)
        return styled_asset.raw_bytes
    else:
        # No textures — fall back to palette recolor on flat materials
        palette = extract_palette(
            str(drawing_path), k=DEFAULT_PALETTE_K,
            background_color=DRAWING_BACKGROUND_COLOR,
            background_threshold=BACKGROUND_DELTA_E_THRESHOLD,
        )
        styled = recolor_asset(asset, palette, intensity=intensity)
        return styled.raw_bytes


def _run_tier2(
    base_model_path: Path,
    drawing_path: Path,
    style_choice: StyleChoice,
    intensity: float,
) -> bytes:
    """Tier 2: AdaIN neural style transfer on UV textures.

    Applies optimization-based AdaIN (VGG-19 features, Adam 100 steps) to
    every texture atlas in the asset.  Seam-aware blending suppresses edge
    artifacts.  Flat (no-texture) assets fall back to Tier 1 palette transfer.
    """
    import numpy as np
    from PIL import Image

    from style_transfer.config import (
        BACKGROUND_DELTA_E_THRESHOLD, DEFAULT_PALETTE_K, DEVICE, DRAWING_BACKGROUND_COLOR,
    )
    from style_transfer.io.glb_loader import extract_textures, load_glb
    from style_transfer.io.glb_writer import inject_textures
    from style_transfer.neural.adain import VGGEncoder, stylize_texture
    from style_transfer.neural.seam_aware import apply_seam_aware_stylisation

    asset    = load_glb(base_model_path)
    textures = extract_textures(asset)

    if not textures:
        return _run_tier1(base_model_path, drawing_path, style_choice, intensity)

    # Algorithmic filter styles — no neural network, no weights needed
    _ALGO_MAP = {
        "pixel_art":     "apply_pixel_art",
        "low_poly":      "apply_low_poly",
        "sepia":         "apply_sepia",
        "vaporwave":     "apply_vaporwave",
        "cyberpunk_neon":"apply_cyberpunk_neon",
    }
    if style_choice in _ALGO_MAP:
        import importlib
        mod = importlib.import_module("style_transfer.neural.algorithmic")
        fn = getattr(mod, _ALGO_MAP[style_choice])
        styled_textures = {idx: fn(tex, intensity=intensity) for idx, tex in textures.items()}
        styled_asset = inject_textures(asset, styled_textures)
        return styled_asset.raw_bytes

    # Cartoon-family styles — computational, no weights needed
    _CARTOON_MAP = {
        "cartoon":    "cartoonify_texture",
        "anime":      "animeify_texture",
        "cel_shading":"cel_shade_texture",
    }
    if style_choice in _CARTOON_MAP:
        import importlib
        mod = importlib.import_module("style_transfer.neural.cartoon")
        fn = getattr(mod, _CARTOON_MAP[style_choice])
        styled_textures = {idx: fn(tex, intensity=intensity) for idx, tex in textures.items()}
        styled_asset = inject_textures(asset, styled_textures)
        return styled_asset.raw_bytes

    # Feed-forward path: single forward pass per texture (fast, preset styles only)
    ff_net = _try_load_feedforward(style_choice)
    if ff_net is not None:
        from style_transfer.neural.feedforward import stylize_texture as ff_stylize
        styled_textures: dict = {
            idx: ff_stylize(tex, style_choice, intensity=intensity, network=ff_net)
            for idx, tex in textures.items()
        }
        styled_asset = inject_textures(asset, styled_textures)
        return styled_asset.raw_bytes

    # Optimization-based AdaIN path: for child_colors or when no preset weights exist
    drawing_img = np.array(Image.open(drawing_path).convert("RGB"), dtype=np.uint8)

    # Load encoder once and reuse across all textures in this asset
    enc = VGGEncoder().to(DEVICE)
    enc.eval()

    styled_textures = {}
    for idx, tex_array in textures.items():
        uv_mask = tex_array.mean(axis=2) > 5  # non-black pixels ≈ UV island

        def _stylise(t, _enc=enc, _drawing=drawing_img, _intensity=intensity):
            return stylize_texture(
                t, _drawing, intensity=_intensity, encoder=_enc, device=DEVICE,
                background_color=DRAWING_BACKGROUND_COLOR,
                background_threshold=BACKGROUND_DELTA_E_THRESHOLD,
            )

        styled_textures[idx] = apply_seam_aware_stylisation(tex_array, uv_mask, _stylise)

    styled_asset = inject_textures(asset, styled_textures)
    return styled_asset.raw_bytes


def _try_load_feedforward(style_choice: str):
    """Return a loaded StyleNetwork for preset styles, or None.

    Returns None for "child_colors" (arbitrary drawing → must use AdaIN)
    and for any preset whose weights file does not exist yet.
    """
    if style_choice == "child_colors":
        return None
    try:
        from style_transfer.neural.feedforward import load_style_network
        return load_style_network(style_choice)
    except FileNotFoundError:
        return None


def _run_chained(
    base_model_path: Path,
    drawing_path: Path,
    style_choice: StyleChoice,
    intensity: float,
) -> bytes:
    """Chained Tier 1 → Tier 2: palette-correct first, then apply neural style.

    Tier 1 shifts the texture colours toward the child's drawing palette.
    Tier 2 then applies neural artistic style on top of those corrected textures.
    This combines colour accuracy (Tier 1) with artistic quality (Tier 2).
    """
    import tempfile
    from pathlib import Path as _Path

    # Step 1: run Tier 1 → palette-corrected GLB bytes
    tier1_bytes = _run_tier1(base_model_path, drawing_path, style_choice, intensity)

    # Step 2: write to a temp file, then run Tier 2 on it
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as tmp:
        tmp.write(tier1_bytes)
        tmp_path = _Path(tmp.name)

    try:
        return _run_tier2(tmp_path, drawing_path, style_choice, intensity)
    finally:
        tmp_path.unlink(missing_ok=True)


def _run_tier3(
    base_model_path: Path,
    drawing_path: Path,
    style_choice: StyleChoice,
    intensity: float,
) -> bytes:
    """Tier 3: multi-view render-and-bake (requires CUDA — run on Colab)."""
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError(
            "Tier 3 requires CUDA. Run on Google Colab or an NVIDIA GPU machine. "
            "See notebooks/tier3_colab.ipynb for a ready-to-run notebook."
        )

    import numpy as np
    from PIL import Image
    from style_transfer.io.glb_loader import load_glb
    from style_transfer.render.multiview_bake import multiview_stylize

    asset       = load_glb(base_model_path)
    style_image = np.array(Image.open(drawing_path).convert("RGB"), dtype=np.uint8)

    styled_asset = multiview_stylize(
        asset,
        style_image,
        n_views=8,
        image_size=512,
        tex_size=512,
        n_optim_steps=100,
        device="cuda",
    )
    return styled_asset.raw_bytes


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Apply AI style transfer to a .glb model.")
    p.add_argument("--model",   required=True, help="Path to base .glb file")
    p.add_argument("--drawing", required=True, help="Path to child drawing (PNG/JPEG)")
    p.add_argument("--style",   default="child_colors",
                   choices=list(VALID_STYLE_CHOICES), help="Style preset")
    p.add_argument("--intensity", type=float, default=DEFAULT_INTENSITY,
                   help="Blend intensity 0.0–1.0")
    p.add_argument("--out",     default=None, help="Output .glb path")
    p.add_argument("--tier",    type=int, default=1, choices=[1, 2, 3, 12],
                   help="Method tier (1=palette, 2=neural, 3=render-bake, 12=chained 1→2)")
    return p


if __name__ == "__main__":
    args = _build_parser().parse_args()
    result = stylize(
        base_model_path=args.model,
        drawing_path=args.drawing,
        style_choice=args.style,
        intensity=args.intensity,
        output_path=args.out,
        tier=args.tier,
    )
    print(result)

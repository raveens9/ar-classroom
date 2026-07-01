"""Lightweight 2D preview renderer for before/after style-transfer comparisons.

Produces a composite PNG using PIL:

    [Drawing thumbnail]     [Drawing palette k=6]
    [Original texture]      [Styled texture]

For FLAT assets the texture tiles show material colour swatches instead of a
texture atlas.  No 3D rasterisation or display needed — all rendering is pure
PIL on the 2D data already embedded in the .glb files.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from style_transfer.io.glb_loader import GlbAsset, extract_textures, load_glb
from style_transfer.palette.extract import extract_palette, palette_to_swatch

_TILE = 300   # default tile side in pixels
_BAR  = 30    # label-bar height in pixels


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _label_bar(
    text: str,
    width: int,
    bg: tuple[int, int, int] = (50, 50, 50),
    fg: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    bar = Image.new("RGB", (width, _BAR), bg)
    draw = ImageDraw.Draw(bar)
    try:
        font = ImageFont.load_default(size=15)
    except TypeError:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    x = max(4, (width - (bbox[2] - bbox[0])) // 2)
    y = max(2, (_BAR - (bbox[3] - bbox[1])) // 2)
    draw.text((x, y), text, fill=fg, font=font)
    return bar


def _fit_into(img: Image.Image, size: int) -> Image.Image:
    """Thumbnail-resize img to fit inside size×size, centred on white."""
    img.thumbnail((size, size), Image.LANCZOS)
    tile = Image.new("RGB", (size, size), (255, 255, 255))
    tile.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
    return tile


def _texture_tile(asset: GlbAsset, size: int) -> Image.Image:
    """First colour texture thumbnail, or a flat-swatch strip for FLAT assets."""
    textures = extract_textures(asset)
    if textures:
        img_idx = next(iter(sorted(textures)))
        return _fit_into(Image.fromarray(textures[img_idx], "RGB"), size)
    # FLAT asset — show material base-colour swatches
    factors = [m.base_color_factor for m in asset.material_infos]
    if not factors:
        return Image.new("RGB", (size, size), (200, 200, 200))
    n   = len(factors)
    sw  = max(1, size // n)
    tile = Image.new("RGB", (size, size), (255, 255, 255))
    for i, (r, g, b, *_) in enumerate(factors):
        c = (int(r * 255), int(g * 255), int(b * 255))
        tile.paste(Image.new("RGB", (sw, size), c), (i * sw, 0))
    return tile


def _drawing_tile(drawing_path: Path, size: int) -> Image.Image:
    return _fit_into(Image.open(drawing_path).convert("RGB"), size)


def _palette_tile(drawing_path: Path, size: int, k: int = 6) -> Image.Image:
    palette = extract_palette(str(drawing_path), k=k)
    swatch  = palette_to_swatch(palette, swatch_w=max(1, size // k), swatch_h=size)
    tile    = Image.new("RGB", (size, size), (255, 255, 255))
    tile.paste(swatch, (0, 0))
    return tile


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_preview(
    base_model_path: str | Path,
    styled_model_path: str | Path,
    drawing_path: str | Path,
    output_path: str | Path,
    tile_size: int = _TILE,
) -> Path:
    """Generate a 2×2 before/after comparison PNG.

    Layout (each cell = tile_size × tile_size + label bar):

        [Drawing]                [Drawing palette (k=6)]
        [BEFORE: texture/swatches] [AFTER: texture/swatches]

    Args:
        base_model_path: Path to the original .glb.
        styled_model_path: Path to the Tier-1 styled .glb.
        drawing_path: Path to the child's drawing (PNG/JPEG).
        output_path: Destination PNG path.
        tile_size: Side length (px) of each image tile.

    Returns:
        Path to the written PNG.
    """
    base_path    = Path(base_model_path)
    styled_path  = Path(styled_model_path)
    drawing_path = Path(drawing_path)
    output_path  = Path(output_path)

    base_asset   = load_glb(base_path)
    styled_asset = load_glb(styled_path)

    t = tile_size
    cell_h  = _BAR + t
    canvas  = Image.new("RGB", (t * 2, cell_h * 2), (230, 230, 230))

    def paste(tile: Image.Image, label: str, col: int, row: int,
              bar_bg: tuple = (50, 50, 50)) -> None:
        bar = _label_bar(label, t, bg=bar_bg)
        y = row * cell_h
        x = col * t
        canvas.paste(bar,  (x, y))
        canvas.paste(tile, (x, y + _BAR))

    paste(_drawing_tile(drawing_path, t),
          f"Drawing: {drawing_path.stem}", 0, 0, bar_bg=(30, 110, 30))

    paste(_palette_tile(drawing_path, t),
          "Drawing palette (k=6)",          1, 0, bar_bg=(30, 110, 30))

    paste(_texture_tile(base_asset, t),
          f"BEFORE: {base_path.stem}",      0, 1, bar_bg=(130, 40, 40))

    paste(_texture_tile(styled_asset, t),
          "AFTER: Tier 1 palette transfer", 1, 1, bar_bg=(40, 40, 130))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(str(output_path), format="PNG")
    return output_path


def batch_preview(
    pairs: list[dict],
    output_dir: str | Path,
    tile_size: int = _TILE,
) -> list[Path]:
    """Run generate_preview for a list of model/drawing pairs.

    Args:
        pairs: List of dicts, each with keys:
               'base' — original .glb path
               'styled' — styled .glb path
               'drawing' — drawing path
               'name' — stem used for the output filename
        output_dir: Directory to write PNG files.
        tile_size: Tile side in pixels.

    Returns:
        List of output PNG paths.
    """
    output_dir = Path(output_dir)
    results: list[Path] = []
    for p in pairs:
        out = output_dir / f"{p['name']}_preview.png"
        results.append(
            generate_preview(p["base"], p["styled"], p["drawing"], out, tile_size)
        )
    return results

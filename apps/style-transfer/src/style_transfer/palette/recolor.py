"""Remap .glb materials and textures to match a target colour palette.

Supports two code paths:
  - Flat-colour materials (baseColorFactor only, no texture image)
  - Textured materials (pixel-level remapping of the texture atlas)
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image as _PILImage
from PIL import Image
from skimage.color import lab2rgb, rgb2lab

from style_transfer.io.glb_loader import GlbAsset, MaterialType

_MAX_PROCESS_SIZE = 512  # cap large textures before palette lookup; upsample after


def recolor_texture_histogram(
    texture: np.ndarray,
    drawing: np.ndarray,
    intensity: float = 0.8,
) -> np.ndarray:
    """Transfer the drawing's colour distribution to the texture via histogram matching.

    Replaces the nearest-neighbour Lab approach, which collapses dark textures
    to white/black when the drawing has vivid colours the texture never contains.
    Histogram matching redistributes all drawing colours across the full
    brightness range of the texture, so blue/orange/yellow all get applied.

    Args:
        texture: RGB uint8 array (H, W, 3).
        drawing: RGB uint8 array (H, W, 3) — the child's drawing.
        intensity: Blend strength; 1.0 = full match, 0.0 = unchanged.

    Returns:
        Recoloured uint8 array (H, W, 3).
    """
    from skimage.exposure import match_histograms

    matched = match_histograms(texture, drawing, channel_axis=-1).astype(np.float32)
    original = texture.astype(np.float32)
    blended = intensity * matched + (1.0 - intensity) * original
    return np.clip(blended, 0, 255).round().astype(np.uint8)


def _downscale(arr: np.ndarray) -> tuple[np.ndarray, tuple[int, int] | None]:
    h, w = arr.shape[:2]
    if max(h, w) <= _MAX_PROCESS_SIZE:
        return arr, None
    scale = _MAX_PROCESS_SIZE / max(h, w)
    nh, nw = max(1, int(h * scale)), max(1, int(w * scale))
    mode = "RGBA" if (arr.ndim == 3 and arr.shape[2] == 4) else "RGB"
    return np.array(_PILImage.fromarray(arr, mode).resize((nw, nh), _PILImage.LANCZOS)), (h, w)


def _upscale(arr: np.ndarray, orig_hw: tuple[int, int] | None) -> np.ndarray:
    if orig_hw is None:
        return arr
    oh, ow = orig_hw
    mode = "RGBA" if (arr.ndim == 3 and arr.shape[2] == 4) else "RGB"
    return np.array(_PILImage.fromarray(arr, mode).resize((ow, oh), _PILImage.LANCZOS))


def recolor_flat_material(
    base_color: tuple[float, float, float, float],
    target_palette: np.ndarray,
    intensity: float = 0.8,
) -> tuple[float, float, float, float]:
    """Map a single flat baseColorFactor to the nearest palette colour.

    Uses CIE76 Delta-E distance (Lab Euclidean) to find the closest palette entry,
    then linearly interpolates between original and palette colour at `intensity`.

    Args:
        base_color: Original RGBA (0.0–1.0 each) from the glTF material.
        target_palette: Float32 (k, 3) sRGB palette from palette.extract.
        intensity: Blend weight; 1.0 = full palette colour, 0.0 = unchanged.

    Returns:
        Remapped RGBA tuple, alpha preserved from input.
    """
    # float64 + errstate: Apple Accelerate BLAS emits spurious divide-by-zero
    # warnings on the XYZ matmul; the result is correct.
    rgb = np.clip(np.array(base_color[:3], dtype=np.float64), 1e-5, 1.0)
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        lab_color = rgb2lab(rgb.reshape(1, 1, 3))[0, 0].astype(np.float32)

        palette_lab = rgb2lab(
            np.clip(target_palette.astype(np.float64), 1e-5, 1.0).reshape(1, -1, 3)
        ).reshape(-1, 3).astype(np.float32)

    diff = lab_color - palette_lab          # (k, 3)
    sq_dists = np.einsum("ij,ij->i", diff, diff)
    nearest_rgb = target_palette[int(np.argmin(sq_dists))]

    original_rgb = np.array(base_color[:3], dtype=np.float32)
    blended = np.clip(nearest_rgb * intensity + original_rgb * (1.0 - intensity), 0.0, 1.0)

    alpha = float(base_color[3]) if len(base_color) > 3 else 1.0
    return (float(blended[0]), float(blended[1]), float(blended[2]), alpha)


def recolor_texture(
    texture: np.ndarray,
    target_palette: np.ndarray,
    intensity: float = 0.8,
) -> np.ndarray:
    """Pixel-wise remap a texture image to the target palette.

    Each pixel is replaced by its nearest palette colour (CIE76 in Lab space),
    then blended with the original at the given intensity.

    Memory-efficient: iterates over k palette entries rather than materialising
    a full (N, k, 3) distance array. Safe for 2048×2048 textures.

    Args:
        texture: RGB or RGBA uint8 array (H, W, C).
        target_palette: Float32 (k, 3) sRGB palette.
        intensity: Blend weight; 1.0 = full palette replacement, 0.0 = unchanged.

    Returns:
        Recoloured uint8 array of the same shape (alpha channel is preserved).
    """
    has_alpha = texture.ndim == 3 and texture.shape[2] == 4
    h, w = texture.shape[:2]
    n = h * w

    rgb = texture[..., :3]
    # float64 + errstate: Apple Accelerate BLAS emits spurious divide-by-zero on
    # the rgb2xyz matmul inside rgb2lab; the result is numerically correct.
    pixels_f64 = np.clip(rgb.reshape(n, 3).astype(np.float64) / 255.0, 1e-5, 1.0)
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        pixels_lab = rgb2lab(pixels_f64.reshape(1, n, 3)).reshape(n, 3).astype(np.float32)
        palette_lab = rgb2lab(
            np.clip(target_palette.astype(np.float64), 1e-5, 1.0).reshape(1, -1, 3)
        ).reshape(-1, 3).astype(np.float32)
    pixels_f = pixels_f64.astype(np.float32)

    k = len(target_palette)

    # Iterate over k entries to avoid a large (N, k, 3) intermediate array
    min_sq = np.full(n, np.inf, dtype=np.float32)
    nearest_idx = np.zeros(n, dtype=np.int32)
    for i in range(k):
        d = pixels_lab - palette_lab[i]           # (N, 3)
        sq = np.einsum("ij,ij->i", d, d)          # (N,)
        mask = sq < min_sq
        min_sq[mask] = sq[mask]
        nearest_idx[mask] = i

    nearest_rgb = target_palette[nearest_idx]     # (N, 3) float32
    blended = nearest_rgb * intensity + pixels_f * (1.0 - intensity)
    result_rgb = np.clip(blended * 255.0, 0, 255).round().astype(np.uint8).reshape(h, w, 3)

    if has_alpha:
        return np.concatenate([result_rgb, texture[..., 3:4]], axis=2)
    return result_rgb


def recolor_asset(
    asset: GlbAsset,
    target_palette: np.ndarray,
    intensity: float = 0.8,
) -> GlbAsset:
    """Recolour an entire GlbAsset to match a target palette.

    Dispatches each material to the flat or texture code path based on its type.
    Geometry is never touched.

    Args:
        asset: Loaded GlbAsset (from io.glb_loader.load_glb).
        target_palette: Float32 (k, 3) sRGB palette from palette.extract.
        intensity: Blend weight; 1.0 = full palette replacement, 0.0 = unchanged.

    Returns:
        New GlbAsset with recoloured materials/textures. Geometry unchanged.
    """
    from style_transfer.io.glb_writer import inject_textures, update_material_colors

    material_colors: dict[int, tuple[float, float, float, float]] = {}
    texture_updates: dict[int, np.ndarray] = {}

    # Decode textures from raw bytes, preserving alpha where present
    raw_textures: dict[int, np.ndarray] = {}
    for m in asset.material_infos:
        img_idx = m.base_color_texture_index
        if img_idx is not None and img_idx not in raw_textures:
            raw = asset.image_bytes.get(img_idx)
            if raw is not None:
                pil = Image.open(io.BytesIO(raw))
                mode = "RGBA" if "A" in pil.mode else "RGB"
                raw_textures[img_idx] = np.array(pil.convert(mode), dtype=np.uint8)

    for m in asset.material_infos:
        if m.mat_type == MaterialType.FLAT:
            material_colors[m.index] = recolor_flat_material(
                m.base_color_factor, target_palette, intensity
            )
        elif m.mat_type in (MaterialType.TEXTURED, MaterialType.KHR_SPEC):
            img_idx = m.base_color_texture_index
            if img_idx is not None and img_idx in raw_textures:
                if img_idx not in texture_updates:
                    texture_updates[img_idx] = recolor_texture(
                        raw_textures[img_idx], target_palette, intensity
                    )
            else:
                # KHR_SPEC or TEXTURED with no resolvable texture → treat as flat
                material_colors[m.index] = recolor_flat_material(
                    m.base_color_factor, target_palette, intensity
                )
        # UNKNOWN materials are left untouched

    result = asset
    if material_colors:
        result = update_material_colors(result, material_colors)
    if texture_updates:
        result = inject_textures(result, texture_updates)
    return result

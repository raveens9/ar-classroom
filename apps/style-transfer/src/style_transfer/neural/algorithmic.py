"""Algorithmic (filter-based) style effects — no neural network, no training.

All functions share the same signature:
    apply_<style>(texture: np.ndarray, intensity: float = 0.8, ...) -> np.ndarray

intensity=0.0 always returns the original unchanged; intensity=1.0 applies the
full effect. All inputs and outputs are RGB uint8 arrays (H, W, 3).
"""

from __future__ import annotations

import numpy as np
from PIL import Image as _PILImage
from scipy.ndimage import gaussian_filter
from scipy.spatial import Delaunay
from skimage.color import hsv2rgb, rgb2hsv
from skimage.draw import polygon as sk_polygon
from skimage.feature import corner_harris, corner_peaks
from sklearn.cluster import MiniBatchKMeans

_MAX_PROCESS_SIZE = 512


def _downscale(arr: np.ndarray) -> tuple[np.ndarray, tuple[int, int] | None]:
    h, w = arr.shape[:2]
    if max(h, w) <= _MAX_PROCESS_SIZE:
        return arr, None
    scale = _MAX_PROCESS_SIZE / max(h, w)
    nh, nw = max(1, int(h * scale)), max(1, int(w * scale))
    return np.array(_PILImage.fromarray(arr).resize((nw, nh), _PILImage.LANCZOS)), (h, w)


def _upscale(arr: np.ndarray, orig_hw: tuple[int, int] | None) -> np.ndarray:
    if orig_hw is None:
        return arr
    oh, ow = orig_hw
    return np.array(_PILImage.fromarray(arr).resize((ow, oh), _PILImage.LANCZOS))


# ---------------------------------------------------------------------------
# Pixel art
# ---------------------------------------------------------------------------

def apply_pixel_art(
    texture: np.ndarray,
    intensity: float = 0.8,
    block_size: int = 8,
    n_colors: int = 16,
) -> np.ndarray:
    """Pixel-art effect: downscale → colour-quantise → upscale (nearest).

    Args:
        texture: RGB uint8 (H, W, 3).
        intensity: Blend strength.
        block_size: Pixel-block side length in the original image.
        n_colors: Palette size after quantisation.

    Returns:
        Pixel-art RGB uint8 (H, W, 3).
    """
    original = texture.astype(np.float32) / 255.0
    h, w = texture.shape[:2]
    sh, sw = max(1, h // block_size), max(1, w // block_size)

    small = np.array(
        _PILImage.fromarray(texture).resize((sw, sh), _PILImage.NEAREST)
    )
    pixels = small.reshape(-1, 3).astype(np.float64) / 255.0
    km = MiniBatchKMeans(n_clusters=n_colors, n_init=3, random_state=0)
    labels = km.fit_predict(pixels)
    quantised = np.clip(km.cluster_centers_[labels].reshape(sh, sw, 3), 0.0, 1.0)
    quantised = (quantised * 255).astype(np.uint8)

    styled = (
        np.array(_PILImage.fromarray(quantised).resize((w, h), _PILImage.NEAREST))
        .astype(np.float32) / 255.0
    )
    blended = intensity * styled + (1.0 - intensity) * original
    return (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Low-poly
# ---------------------------------------------------------------------------

def apply_low_poly(
    texture: np.ndarray,
    intensity: float = 0.8,
    n_points: int = 400,
) -> np.ndarray:
    """Low-poly geometric effect via Delaunay triangulation.

    Detects Harris corners as triangle vertices, triangulates, then fills each
    triangle with the mean colour of the pixels inside it.

    Args:
        texture: RGB uint8 (H, W, 3).
        intensity: Blend strength.
        n_points: Target number of triangle vertices (approximate).

    Returns:
        Low-poly RGB uint8 (H, W, 3).
    """
    original = texture.astype(np.float32) / 255.0
    h, w = texture.shape[:2]
    grey = (original @ np.array([0.2126, 0.7152, 0.0722])).astype(np.float32)

    # Harris corner detection for interest points
    min_dist = max(3, min(h, w) // 40)
    response = corner_harris(grey)
    coords_yx = corner_peaks(response, min_distance=min_dist, num_peaks=n_points - 8)

    # Fallback: random scatter when the image has no texture
    if coords_yx.shape[0] < 20:
        rng = np.random.default_rng(0)
        coords_yx = np.column_stack([
            rng.integers(1, h - 1, size=n_points - 8),
            rng.integers(1, w - 1, size=n_points - 8),
        ])

    # Always include corners + edge midpoints so the mesh covers the full image
    extras = np.array([
        [0, 0], [0, w - 1], [h - 1, 0], [h - 1, w - 1],
        [h // 2, 0], [h // 2, w - 1], [0, w // 2], [h - 1, w // 2],
    ])
    all_yx = np.vstack([coords_yx, extras])

    pts_xy = all_yx[:, [1, 0]].astype(float)
    tri = Delaunay(pts_xy)

    styled = np.zeros_like(original)
    for simplex in tri.simplices:
        pts = pts_xy[simplex]
        rr, cc = sk_polygon(pts[:, 1], pts[:, 0], shape=(h, w))
        if rr.size == 0:
            continue
        styled[rr, cc] = original[rr, cc].mean(axis=0)

    blended = intensity * styled + (1.0 - intensity) * original
    return (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Sepia / vintage
# ---------------------------------------------------------------------------

def apply_sepia(
    texture: np.ndarray,
    intensity: float = 0.8,
) -> np.ndarray:
    """Classic sepia / vintage photograph effect via a 3×3 colour matrix.

    Args:
        texture: RGB uint8 (H, W, 3).
        intensity: Blend strength.

    Returns:
        Sepia-toned RGB uint8 (H, W, 3).
    """
    original = texture.astype(np.float32) / 255.0
    r, g, b = original[:, :, 0], original[:, :, 1], original[:, :, 2]
    styled = np.stack([
        np.clip(r * 0.393 + g * 0.769 + b * 0.189, 0.0, 1.0),
        np.clip(r * 0.349 + g * 0.686 + b * 0.168, 0.0, 1.0),
        np.clip(r * 0.272 + g * 0.534 + b * 0.131, 0.0, 1.0),
    ], axis=2)
    blended = intensity * styled + (1.0 - intensity) * original
    return (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Vaporwave / synthwave
# ---------------------------------------------------------------------------

def apply_vaporwave(
    texture: np.ndarray,
    intensity: float = 0.8,
) -> np.ndarray:
    """Vaporwave / synthwave aesthetic — pink+purple shadows, cyan highlights.

    Boosts saturation then softly tints shadows towards purple and highlights
    towards cyan using luminance-weighted blending.

    Args:
        texture: RGB uint8 (H, W, 3).
        intensity: Blend strength.

    Returns:
        Vaporwave-styled RGB uint8 (H, W, 3).
    """
    work, orig_hw = _downscale(texture)
    original = work.astype(np.float32) / 255.0

    hsv = rgb2hsv(original)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 1.5, 0.0, 1.0)
    vivid = np.clip(hsv2rgb(hsv), 0.0, 1.0).astype(np.float32)

    lum = original @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    shadow_w    = np.clip(1.0 - lum * 2.5, 0.0, 1.0)[:, :, np.newaxis]
    highlight_w = np.clip((lum - 0.5) * 2.5, 0.0, 1.0)[:, :, np.newaxis]

    purple = np.array([0.6, 0.2, 0.8], dtype=np.float32)
    cyan   = np.array([0.2, 0.9, 0.9], dtype=np.float32)

    styled = (
        vivid * (1.0 - shadow_w * 0.35 - highlight_w * 0.35)
        + purple * shadow_w * 0.35
        + cyan   * highlight_w * 0.35
    )
    styled = np.clip(styled, 0.0, 1.0).astype(np.float32)

    blended = intensity * styled + (1.0 - intensity) * original
    result = (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)
    return _upscale(result, orig_hw)


# ---------------------------------------------------------------------------
# Cyberpunk neon
# ---------------------------------------------------------------------------

def apply_cyberpunk_neon(
    texture: np.ndarray,
    intensity: float = 0.8,
    bloom_sigma: float = 3.0,
) -> np.ndarray:
    """Cyberpunk neon effect — dark base with vivid glowing highlights.

    Darkens the image, then extracts bright regions as neon sources and adds
    a Gaussian bloom around them.

    Args:
        texture: RGB uint8 (H, W, 3).
        intensity: Blend strength.
        bloom_sigma: Gaussian spread of the neon glow in pixels.

    Returns:
        Cyberpunk-styled RGB uint8 (H, W, 3).
    """
    work, orig_hw = _downscale(texture)
    original = work.astype(np.float32) / 255.0

    hsv = rgb2hsv(original)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * 2.0, 0.0, 1.0)
    vivid = np.clip(hsv2rgb(hsv), 0.0, 1.0).astype(np.float32)

    lum = original @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    bright_mask = (lum > 0.5).astype(np.float32)[:, :, np.newaxis]
    neon = vivid * bright_mask

    bloom = np.stack([
        gaussian_filter(neon[:, :, c], sigma=bloom_sigma) for c in range(3)
    ], axis=2)

    darkened = original * 0.4
    styled = np.clip(darkened + neon * 0.8 + bloom * 0.6, 0.0, 1.0).astype(np.float32)

    blended = intensity * styled + (1.0 - intensity) * original
    result = (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)
    return _upscale(result, orig_hw)

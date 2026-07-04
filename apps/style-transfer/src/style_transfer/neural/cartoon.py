"""Computational cartoon / comic-book style effect.

Gram-matrix feed-forward NST cannot reproduce cartoon style because cartoon is
defined by flat colour regions, clean outlines, and shape simplification —
not by local texture statistics. This module uses a classical CV pipeline:

  1. Colour quantisation   — k-means reduces the palette to flat regions
  2. Bilateral filtering   — smooths within regions while preserving edges
  3. Edge detection        — Canny finds strong structural outlines
  4. Edge overlay          — black outlines composited over smoothed image

No training is required; the method runs entirely on CPU via skimage/sklearn.
A GAN-based approach (AnimeGANv2, CartoonGAN) would give higher quality but
requires separate training infrastructure and is out of scope for this project.
"""

from __future__ import annotations

import numpy as np
from PIL import Image as _PILImage
from scipy.ndimage import binary_dilation
from skimage.color import hsv2rgb, rgb2hsv
from skimage.feature import canny
from skimage.restoration import denoise_bilateral
from sklearn.cluster import MiniBatchKMeans

_MAX_PROCESS_SIZE = 512  # downsample large textures before style; upsample after


def _downscale(arr: np.ndarray) -> tuple[np.ndarray, tuple[int, int]]:
    """Return (resized_uint8, original_hw) if larger than _MAX_PROCESS_SIZE, else (arr, None)."""
    h, w = arr.shape[:2]
    if max(h, w) <= _MAX_PROCESS_SIZE:
        return arr, (h, w)
    scale = _MAX_PROCESS_SIZE / max(h, w)
    nh, nw = max(1, int(h * scale)), max(1, int(w * scale))
    resized = np.array(_PILImage.fromarray(arr).resize((nw, nh), _PILImage.LANCZOS))
    return resized, (h, w)


def _upscale(arr: np.ndarray, orig_hw: tuple[int, int] | None) -> np.ndarray:
    if orig_hw is None:
        return arr
    oh, ow = orig_hw
    return np.array(_PILImage.fromarray(arr).resize((ow, oh), _PILImage.LANCZOS))


def cartoonify_texture(
    texture: np.ndarray,
    intensity: float = 0.8,
    n_colors: int = 8,
    edge_sigma: float = 1.0,
    smooth_sigma_color: float = 0.15,
    smooth_sigma_spatial: float = 3,
) -> np.ndarray:
    """Apply a cartoon effect to a single texture image.

    Args:
        texture: RGB uint8 array (H, W, 3).
        intensity: Blend strength (0.0 = original, 1.0 = fully cartoon).
        n_colors: Number of quantised palette colours (flat colour regions).
        edge_sigma: Canny edge detection sigma (higher = fewer, coarser edges).
        smooth_sigma_color: Bilateral colour sigma in [0, 1].
        smooth_sigma_spatial: Bilateral spatial sigma in pixels.

    Returns:
        Cartoonified RGB uint8 array (H, W, 3).
    """
    work, orig_hw = _downscale(texture)
    original = work.astype(np.float32) / 255.0
    h, w = work.shape[:2]

    # 1. Colour quantisation — flat colour regions
    pixels = original.reshape(-1, 3).astype(np.float64)
    km = MiniBatchKMeans(n_clusters=n_colors, n_init=3, random_state=0)
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        labels = km.fit_predict(pixels)
    quantised = km.cluster_centers_[labels].reshape(h, w, 3).astype(np.float32)
    quantised = np.clip(quantised, 0.0, 1.0)

    # 2. Bilateral smoothing — smooth within regions, keep edges sharp
    smoothed = np.empty_like(quantised)
    for c in range(3):
        smoothed[:, :, c] = denoise_bilateral(
            quantised[:, :, c],
            sigma_color=smooth_sigma_color,
            sigma_spatial=smooth_sigma_spatial,
        )
    smoothed = np.clip(smoothed, 0.0, 1.0)

    # 3. Edge detection on luminance channel
    grey = smoothed @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    edges = canny(grey, sigma=edge_sigma)  # bool mask (H, W)

    # 4. Overlay black outlines
    styled = smoothed.copy()
    styled[edges] = 0.0

    blended = intensity * styled + (1.0 - intensity) * original
    result = (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)
    return _upscale(result, orig_hw)


def animeify_texture(
    texture: np.ndarray,
    intensity: float = 0.8,
    n_colors: int = 12,
    edge_sigma: float = 0.8,
    smooth_sigma_color: float = 0.12,
    smooth_sigma_spatial: float = 5,
    saturation_boost: float = 1.4,
) -> np.ndarray:
    """Apply a computational anime-style effect.

    Like cartoon but uses softer/thinner edges, more palette colours, and a
    saturation boost to approximate anime aesthetics without a GAN.
    A purpose-trained GAN (AnimeGANv2) would give higher quality but is out
    of scope for this project.

    Args:
        texture: RGB uint8 array (H, W, 3).
        intensity: Blend strength (0.0 = original, 1.0 = fully anime).
        n_colors: Palette size for colour quantisation.
        edge_sigma: Canny sigma (lower = finer edges than cartoon).
        smooth_sigma_color: Bilateral colour sigma.
        smooth_sigma_spatial: Bilateral spatial sigma in pixels.
        saturation_boost: HSV saturation multiplier.

    Returns:
        Anime-stylised RGB uint8 array (H, W, 3).
    """
    work, orig_hw = _downscale(texture)
    original = work.astype(np.float32) / 255.0
    h, w = work.shape[:2]

    # 1. Colour quantisation
    pixels = original.reshape(-1, 3).astype(np.float64)
    km = MiniBatchKMeans(n_clusters=n_colors, n_init=3, random_state=0)
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        labels = km.fit_predict(pixels)
    quantised = np.clip(km.cluster_centers_[labels].reshape(h, w, 3), 0.0, 1.0).astype(np.float32)

    # 2. Soft bilateral smoothing
    smoothed = np.empty_like(quantised)
    for c in range(3):
        smoothed[:, :, c] = denoise_bilateral(
            quantised[:, :, c],
            sigma_color=smooth_sigma_color,
            sigma_spatial=smooth_sigma_spatial,
        )
    smoothed = np.clip(smoothed, 0.0, 1.0)

    # 3. Saturation boost in HSV space
    hsv = rgb2hsv(smoothed)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * saturation_boost, 0.0, 1.0)
    smoothed = np.clip(hsv2rgb(hsv), 0.0, 1.0).astype(np.float32)

    # 4. Thin edge overlay (dark tint rather than pure black)
    grey = smoothed @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    edges = canny(grey, sigma=edge_sigma)
    styled = smoothed.copy()
    styled[edges] *= 0.15

    blended = intensity * styled + (1.0 - intensity) * original
    result = (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)
    return _upscale(result, orig_hw)


def cel_shade_texture(
    texture: np.ndarray,
    intensity: float = 0.8,
    n_tones: int = 4,
    edge_sigma: float = 1.5,
    edge_thickness: int = 2,
    saturation_boost: float = 1.3,
) -> np.ndarray:
    """Apply a cel-shading (toon-shading) effect.

    Quantises the value channel to discrete lighting tones and overlays thick
    outlines, approximating the look of cel-animated 3D rendering.

    Args:
        texture: RGB uint8 array (H, W, 3).
        intensity: Blend strength.
        n_tones: Number of discrete value steps (e.g. shadow/mid/highlight).
        edge_sigma: Canny sigma for outline detection.
        edge_thickness: Outline width in pixels (binary_dilation iterations).
        saturation_boost: HSV saturation multiplier.

    Returns:
        Cel-shaded RGB uint8 array (H, W, 3).
    """
    work, orig_hw = _downscale(texture)
    original = work.astype(np.float32) / 255.0

    # 1. Quantise the value channel to n_tones discrete levels
    hsv = rgb2hsv(original)
    v = hsv[:, :, 2]
    v_q = np.floor(v * n_tones) / n_tones
    hsv_q = hsv.copy()
    hsv_q[:, :, 2] = v_q
    hsv_q[:, :, 1] = np.clip(hsv_q[:, :, 1] * saturation_boost, 0.0, 1.0)
    shaded = np.clip(hsv2rgb(hsv_q), 0.0, 1.0).astype(np.float32)

    # 2. Thick outline detection
    grey = original @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    edges = canny(grey, sigma=edge_sigma)
    if edge_thickness > 1:
        edges = binary_dilation(edges, iterations=edge_thickness - 1)

    styled = shaded.copy()
    styled[edges] = 0.0

    blended = intensity * styled + (1.0 - intensity) * original
    result = (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)
    return _upscale(result, orig_hw)

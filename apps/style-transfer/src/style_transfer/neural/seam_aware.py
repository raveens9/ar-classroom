"""UV-seam-aware blending to suppress stylisation artifacts at texture seams.

UV seams are the central Tier 2 technical challenge: when a texture atlas is
stylised as a flat image, pixels that are neighbours in UV space but distant
on the mesh produce visible seam artifacts on the rendered model.

Mitigations implemented here:
  1. UV-island padding — dilate each island before stylisation to fill the
     gutters that would otherwise show seam edges.
  2. Seam-aware blending — detect seam-adjacent pixels and blend them back
     toward the unstyled original to reduce discontinuities.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import (
    binary_dilation,
    binary_erosion,
    distance_transform_edt,
    gaussian_filter,
)


def pad_uv_islands(
    texture: np.ndarray,
    uv_mask: np.ndarray,
    pad_pixels: int = 4,
) -> np.ndarray:
    """Dilate UV island boundaries outward to fill atlas gutters.

    Uses a nearest-neighbour fill: each gutter pixel receives the colour of
    the nearest island pixel, determined via Euclidean distance transform.

    Args:
        texture:    RGB(A) uint8 texture atlas (H, W, C).
        uv_mask:    Binary mask (H, W) bool — True where UV islands are present.
        pad_pixels: Number of dilation iterations (pixels to expand each island).

    Returns:
        Padded texture of the same shape; gutter pixels filled from nearest
        island edge colour.
    """
    if pad_pixels == 0:
        return texture.copy()

    mask = uv_mask.astype(bool)
    expanded = binary_dilation(mask, iterations=pad_pixels)
    fill_region = expanded & ~mask

    if not fill_region.any():
        return texture.copy()

    # distance_transform_edt(~mask): for each gutter pixel, find nearest island pixel
    _, nearest = distance_transform_edt(~mask, return_indices=True)

    padded = texture.copy()
    rows, cols = np.where(fill_region)
    nr = nearest[0][rows, cols]
    nc = nearest[1][rows, cols]
    padded[rows, cols] = texture[nr, nc]
    return padded


def detect_seam_pixels(uv_mask: np.ndarray, seam_width: int = 2) -> np.ndarray:
    """Return a boolean mask marking pixels within seam_width of a UV boundary.

    Uses morphological erosion: the seam band is the set difference between
    the original mask and an eroded version of it.

    Args:
        uv_mask:    Binary mask (H, W) bool.
        seam_width: Width of the seam band to mark.

    Returns:
        Boolean array (H, W) — True for seam-adjacent pixels.
    """
    mask = uv_mask.astype(bool)
    if seam_width == 0:
        return np.zeros_like(mask)
    eroded = binary_erosion(mask, iterations=seam_width)
    return mask & ~eroded


def blend_seams(
    styled: np.ndarray,
    original: np.ndarray,
    seam_mask: np.ndarray,
    blend_sigma: float = 2.0,
) -> np.ndarray:
    """Blend stylised and original textures along seam boundaries.

    A Gaussian-blurred version of seam_mask provides smooth per-pixel weights
    that pull seam-region pixels toward the original texture, reducing
    visible discontinuities.

    Args:
        styled:      Stylised RGB(A) uint8 array (H, W, C).
        original:    Original RGB(A) uint8 array (H, W, C).
        seam_mask:   Boolean array (H, W) from detect_seam_pixels.
        blend_sigma: Gaussian sigma controlling the blend falloff in pixels.

    Returns:
        Blended uint8 array of the same shape.
    """
    # Gaussian blur spreads the seam mask weight smoothly into the interior
    weight_orig = gaussian_filter(seam_mask.astype(np.float32), sigma=blend_sigma)
    weight_orig = np.clip(weight_orig, 0.0, 1.0)[..., np.newaxis]  # broadcast over C

    blended = (
        (1.0 - weight_orig) * styled.astype(np.float32)
        + weight_orig * original.astype(np.float32)
    )
    return np.clip(blended, 0, 255).astype(np.uint8)


def detect_edge_mask(texture: np.ndarray, radius: int = 1) -> np.ndarray:
    """Approximate UV seam boundaries via Sobel edge detection.

    Useful when an explicit UV mask is not available — edges in the texture
    atlas are a reasonable proxy for UV island boundaries.

    Args:
        texture: RGB(A) uint8 (H, W, C).
        radius:  Dilation radius to widen the edge band.

    Returns:
        Boolean (H, W) mask — True at detected texture edges.
    """
    from scipy.ndimage import sobel

    gray      = texture[..., :3].mean(axis=2).astype(np.float32)
    edge_x    = sobel(gray, axis=0)
    edge_y    = sobel(gray, axis=1)
    magnitude = np.hypot(edge_x, edge_y)
    threshold = magnitude.mean() + magnitude.std()
    edge_mask = magnitude > threshold
    if radius > 0:
        edge_mask = binary_dilation(edge_mask, iterations=radius)
    return edge_mask


def measure_seam_delta_e(
    original: np.ndarray,
    styled: np.ndarray,
    seam_mask: np.ndarray,
) -> dict[str, float]:
    """CIE76 ΔE at seam pixels vs interior — quantifies seam artifact severity.

    A high seam/interior ratio indicates that style transfer is producing
    larger colour shifts at seam boundaries than in the interior, which
    correlates with visible seam artifacts on the rendered mesh.

    Args:
        original:  RGB uint8 (H, W, 3) — texture before stylisation.
        styled:    RGB uint8 (H, W, 3) — texture after stylisation.
        seam_mask: Boolean (H, W) from detect_seam_pixels.

    Returns:
        Dict with keys 'seam_delta_e', 'interior_delta_e', 'ratio'.
    """
    from skimage.color import rgb2lab

    orig_lab   = rgb2lab(original.astype(np.float64) / 255.0)
    styled_lab = rgb2lab(styled.astype(np.float64) / 255.0)
    delta_e    = np.sqrt(np.sum((orig_lab - styled_lab) ** 2, axis=2))

    seam_mask   = seam_mask.astype(bool)
    seam_de     = float(delta_e[seam_mask].mean())   if seam_mask.any()  else 0.0
    interior_de = float(delta_e[~seam_mask].mean())  if (~seam_mask).any() else 0.0
    ratio       = seam_de / interior_de if interior_de > 1e-6 else 0.0

    return {
        "seam_delta_e":     round(seam_de, 4),
        "interior_delta_e": round(interior_de, 4),
        "ratio":            round(ratio, 4),
    }


def apply_seam_aware_stylisation(
    texture: np.ndarray,
    uv_mask: np.ndarray,
    stylise_fn,
    pad_pixels: int = 4,
    seam_width: int = 2,
    blend_sigma: float = 2.0,
) -> np.ndarray:
    """Full seam-aware pipeline: pad → stylise → blend seams.

    Args:
        texture:     RGB(A) uint8 texture atlas (H, W, C).
        uv_mask:     Binary UV-island mask (H, W) bool.
        stylise_fn:  Callable (texture_array) → stylised_array (uint8, same shape).
        pad_pixels:  Island dilation amount before stylisation.
        seam_width:  Seam band width for blending.
        blend_sigma: Gaussian falloff for seam blend.

    Returns:
        Stylised uint8 array with seam artifacts suppressed.
    """
    padded    = pad_uv_islands(texture, uv_mask, pad_pixels)
    styled    = stylise_fn(padded)
    seam_band = detect_seam_pixels(uv_mask, seam_width)
    return blend_seams(styled, texture, seam_band, blend_sigma)

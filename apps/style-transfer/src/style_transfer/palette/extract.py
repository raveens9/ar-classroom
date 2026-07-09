"""Extract a dominant colour palette from a child's drawing using k-means.

Works in CIELAB colour space for perceptually uniform cluster distances.
Lab Euclidean distance ≈ Delta-E CIE76, so clusters minimise perceived colour spread.

Pipeline:
    RGB image → float [0,1] → CIELAB → KMeans(k) → cluster centres → sRGB float32
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from skimage.color import lab2rgb, rgb2lab
from sklearn.cluster import KMeans


_MIN_BACKGROUND_KEEP_FRACTION = 0.01  # keep masking only if enough drawing remains
_MIN_BACKGROUND_KEEP_PIXELS = 50


def background_mask(
    image: np.ndarray,
    background_color: tuple[int, int, int],
    threshold: float = 12.0,
) -> np.ndarray:
    """Boolean mask over flattened (H*W,) pixels: True where NOT background.

    Distance to `background_color` is CIE76 Delta-E in Lab space, so it also
    catches the anti-aliased near-background pixels along stroke edges —
    an exact-equality match on the canvas colour would miss those.

    Args:
        image: RGB uint8 array (H, W, 3).
        background_color: The known canvas background colour, e.g. (255, 255, 255).
        threshold: Delta-E below which a pixel is treated as background.

    Returns:
        Bool array of shape (H*W,).
    """
    pixels_rgb = np.clip(image.reshape(-1, 3).astype(np.float64) / 255.0, 1e-5, 1.0)
    bg_rgb = np.clip(np.array(background_color, dtype=np.float64) / 255.0, 1e-5, 1.0)
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        pixels_lab = rgb2lab(pixels_rgb.reshape(1, -1, 3)).reshape(-1, 3)
        bg_lab = rgb2lab(bg_rgb.reshape(1, 1, 3)).reshape(3)
    delta_e = np.sqrt(np.sum((pixels_lab - bg_lab) ** 2, axis=-1))
    return delta_e > threshold


def extract_palette(
    drawing_path: str,
    k: int = 6,
    n_init: int = 10,
    random_state: int = 42,
    background_color: tuple[int, int, int] | None = None,
    background_threshold: float = 12.0,
) -> np.ndarray:
    """Compute the k dominant colours of a drawing via k-means in Lab space.

    Args:
        drawing_path: Path to the child's drawing (PNG/JPEG).
        k: Number of palette colours to extract.
        n_init: Number of KMeans restarts (higher = more stable palette).
        random_state: Seed for reproducibility.
        background_color: If given, canvas background colour to exclude from
            the palette (e.g. the drawing app's fixed canvas colour).
        background_threshold: Delta-E below which a pixel counts as background.

    Returns:
        Float32 array of shape (k, 3) in sRGB [0.0, 1.0].
    """
    img = Image.open(drawing_path).convert("RGB")
    return palette_from_image(np.array(img, dtype=np.uint8), k=k,
                               n_init=n_init, random_state=random_state,
                               background_color=background_color,
                               background_threshold=background_threshold)


def palette_from_image(
    image: np.ndarray,
    k: int = 6,
    n_init: int = 10,
    random_state: int = 42,
    background_color: tuple[int, int, int] | None = None,
    background_threshold: float = 12.0,
) -> np.ndarray:
    """Extract a palette from an RGB uint8 numpy array (H, W, 3).

    Args:
        image: RGB uint8 array (H, W, 3).
        k: Number of palette colours.
        n_init: KMeans restarts.
        random_state: Seed.
        background_color: If given, canvas background colour to exclude from
            the palette so it doesn't get picked up as one of the k colours.
        background_threshold: Delta-E below which a pixel counts as background.

    Returns:
        Float32 array of shape (k, 3) in sRGB [0.0, 1.0].
    """
    if image.ndim != 3 or image.shape[2] != 3:
        raise ValueError(f"Expected (H, W, 3) RGB array, got shape {image.shape}")
    if image.dtype != np.uint8:
        raise ValueError("Expected uint8 image array")

    # Flatten to pixel list, convert to float [0,1] then Lab.
    # Clip away exact 0.0 to prevent divide-by-zero in the XYZ→Lab conversion
    # for pure-black pixels (common in drawing outlines).
    # float64 avoids overflow in skimage's XYZ matmul; clip epsilon prevents
    # divide-by-zero in the Lab conversion for pure-black pixels (drawing outlines).
    pixels_rgb = np.clip(image.reshape(-1, 3).astype(np.float64) / 255.0, 1e-5, 1.0)
    # rgb2lab expects (H, W, 3) — add and remove the row dimension.
    # errstate: Apple Accelerate BLAS emits spurious divide-by-zero on the XYZ matmul.
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        pixels_lab = rgb2lab(pixels_rgb.reshape(1, -1, 3)).reshape(-1, 3)

    if background_color is not None:
        keep = background_mask(image, background_color, background_threshold)
        min_keep = max(k, _MIN_BACKGROUND_KEEP_PIXELS,
                       int(_MIN_BACKGROUND_KEEP_FRACTION * len(pixels_lab)))
        if keep.sum() >= min_keep:
            pixels_lab = pixels_lab[keep]
        # else: masking would leave too little of the drawing to cluster
        # reliably (e.g. a very sparse, thin-lined drawing) — fall back to
        # using every pixel rather than starve k-means.

    # Subsample large images for speed (1M pixels is plenty for k-means)
    max_pixels = 1_000_000
    if len(pixels_lab) > max_pixels:
        rng = np.random.default_rng(random_state)
        idx = rng.choice(len(pixels_lab), size=max_pixels, replace=False)
        pixels_lab = pixels_lab[idx]

    kmeans = KMeans(n_clusters=k, n_init=n_init, random_state=random_state)
    with np.errstate(divide="ignore", over="ignore", invalid="ignore"):
        kmeans.fit(pixels_lab)

    # Convert cluster centres back from Lab to sRGB
    centres_lab = kmeans.cluster_centers_.reshape(1, -1, 3)  # (1, k, 3)
    centres_rgb = lab2rgb(centres_lab).reshape(k, 3)          # (k, 3) float64
    centres_rgb = np.clip(centres_rgb, 0.0, 1.0).astype(np.float32)

    # Sort by lightness (L channel of original Lab centres) — brighter first
    lightness = kmeans.cluster_centers_[:, 0]
    order = np.argsort(-lightness)
    return centres_rgb[order]


def palette_to_swatch(
    palette: np.ndarray,
    swatch_w: int = 80,
    swatch_h: int = 80,
) -> Image.Image:
    """Render a palette as a horizontal strip of colour swatches (for inspection).

    Args:
        palette: Float32 (k, 3) sRGB array from extract_palette.
        swatch_w: Width of each colour block in pixels.
        swatch_h: Height of each colour block in pixels.

    Returns:
        PIL Image of shape (swatch_h, k * swatch_w).
    """
    k = len(palette)
    img = Image.new("RGB", (k * swatch_w, swatch_h))
    for i, color in enumerate(palette):
        r, g, b = (int(c * 255) for c in color)
        block = Image.new("RGB", (swatch_w, swatch_h), (r, g, b))
        img.paste(block, (i * swatch_w, 0))
    return img


def delta_e_cie76(color_a: np.ndarray, color_b: np.ndarray) -> float:
    """CIE76 Delta-E between two sRGB colours (float32, shape (3,)).

    ΔE76 = sqrt((ΔL*)² + (Δa*)² + (Δb*)²)

    Scale reference:
        ΔE < 1.0  — imperceptible
        1–2       — visible to trained eye only
        2–3.5     — clearly noticeable
        3.5–5     — significant difference
        > 5       — strongly different colours

    Args:
        color_a, color_b: sRGB float32 arrays of shape (3,), values in [0,1].

    Returns:
        CIE76 Delta-E scalar.
    """
    lab_a = rgb2lab(color_a.reshape(1, 1, 3))[0, 0]
    lab_b = rgb2lab(color_b.reshape(1, 1, 3))[0, 0]
    return float(np.sqrt(np.sum((lab_a - lab_b) ** 2)))


def mean_min_delta_e(
    palette_out: np.ndarray,
    palette_ref: np.ndarray,
) -> float:
    """Mean minimum CIE76 Delta-E between two palettes.

    For each colour in palette_out, finds its nearest match in palette_ref
    and returns the mean of those minimum distances.

    Lower score → output palette closer to reference (the child's drawing).

    Args:
        palette_out: Float32 (k, 3) sRGB — output palette (styled model).
        palette_ref: Float32 (k, 3) sRGB — reference palette (drawing).

    Returns:
        Mean minimum Delta-E scalar.
    """
    # Convert both to Lab
    lab_out = rgb2lab(palette_out.reshape(1, -1, 3)).reshape(-1, 3)
    lab_ref = rgb2lab(palette_ref.reshape(1, -1, 3)).reshape(-1, 3)

    # Pairwise Euclidean distance (k_out × k_ref)
    diff = lab_out[:, None, :] - lab_ref[None, :, :]   # (k_out, k_ref, 3)
    dist = np.sqrt(np.sum(diff ** 2, axis=-1))           # (k_out, k_ref)

    return float(np.mean(np.min(dist, axis=1)))

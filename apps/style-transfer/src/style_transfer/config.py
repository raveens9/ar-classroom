"""Global configuration: device selection, project paths, and default parameters."""

from pathlib import Path

# Torch is an optional import here so that config (and tests) can be loaded
# without a full venv. All ML modules import torch directly.
try:
    import torch as _torch
    _TORCH_AVAILABLE = True
except ImportError:
    _TORCH_AVAILABLE = False

# ---------------------------------------------------------------------------
# Device — MPS on Apple Silicon, CPU everywhere else. Never hard-code "cuda".
# ---------------------------------------------------------------------------

def get_device() -> str:
    """Return 'mps' if Apple Silicon GPU is available, otherwise 'cpu'."""
    if _TORCH_AVAILABLE and _torch.backends.mps.is_available():
        return "mps"
    return "cpu"

DEVICE: str = get_device()

# ---------------------------------------------------------------------------
# Project paths (all relative to this file's package root)
# ---------------------------------------------------------------------------

_ROOT = Path(__file__).resolve().parents[2]  # repo root

DATA_DIR       = _ROOT / "data"
DRAWINGS_DIR   = DATA_DIR / "drawings"
GLB_DIR        = DATA_DIR / "glb"
STYLES_DIR     = DATA_DIR / "styles"
OUTPUTS_DIR    = DATA_DIR / "outputs"
MODELS_DIR     = _ROOT / "models"

# ---------------------------------------------------------------------------
# Default pipeline parameters
# ---------------------------------------------------------------------------

DEFAULT_PALETTE_K: int   = 6      # number of dominant colours for k-means
DEFAULT_INTENSITY: float = 0.8    # style blend strength (0.0 – 1.0)

VALID_STYLE_CHOICES: tuple[str, ...] = (
    "child_colors",
    # --- Feed-forward trained presets (Johnson et al. 2016) ---
    # Weights trained on Colab; stored in models/<name>.pt
    "watercolor",
    "crayon",
    "oil_painting",
    "van_gogh",
    "impressionism",
    "expressionism",
    "pastel",
    "charcoal",
    "ink_wash",
    "pointillism",
    "ukiyo_e",
    "abstract_kandinsky",
    "mosaic",
    "graffiti",
    "marble",
    # --- Cartoon-family (computational, no training) ---
    "cartoon",      # bilateral + quantise + edge overlay
    "anime",        # softer edges + saturation boost (GAN-quality needs AnimeGANv2)
    "cel_shading",  # discrete value tones + thick outline
    # --- Algorithmic filter effects (no training) ---
    "pixel_art",
    "low_poly",
    "sepia",
    "vaporwave",
    "cyberpunk_neon",
)

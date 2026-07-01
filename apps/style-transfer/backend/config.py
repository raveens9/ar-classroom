"""Backend-specific configuration: paths, style metadata, CORS origins."""

from __future__ import annotations

import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT       = Path(__file__).resolve().parent.parent
DATA_DIR   = ROOT / "data"
GLB_DIR    = DATA_DIR / "glb"
OUTPUTS_DIR = DATA_DIR / "outputs"
CATALOG_PATH = DATA_DIR / "glb" / "catalog.json"
MODELS_DIR = ROOT / "models"

# ---------------------------------------------------------------------------
# CORS — update ALLOWED_ORIGINS in production to your web app domain
# ---------------------------------------------------------------------------

ALLOWED_ORIGINS: list[str] = ["*"]

# ---------------------------------------------------------------------------
# Style metadata — description + category for the /styles endpoint
# ---------------------------------------------------------------------------

STYLE_CATALOGUE: dict[str, dict] = {
    # ── Palette / colour transfer ─────────────────────────────────────────
    "child_colors": {
        "description": "Transfers the colour distribution of the child's drawing directly onto the model using histogram matching.",
        "category": "palette",
        "tiers_supported": [1, 2, 12],
        "requires_drawing": True,
        "instant": True,
    },
    # ── Feed-forward neural presets (trained weights) ─────────────────────
    "watercolor": {
        "description": "Soft, translucent watercolour washes with paper texture bleeding.",
        "category": "neural_trained",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "crayon": {
        "description": "Rough, waxy crayon strokes with visible texture.",
        "category": "neural_trained",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "oil_painting": {
        "description": "Rich oil paint with thick impasto-like brushwork.",
        "category": "neural_trained",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "van_gogh": {
        "description": "Swirling, energetic brushstrokes inspired by Van Gogh's Starry Night.",
        "category": "neural_trained",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "mosaic": {
        "description": "Byzantine-style coloured tile mosaic with grout lines.",
        "category": "neural_trained",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "impressionism": {
        "description": "Loose, visible dabs of colour in the Impressionist tradition.",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "expressionism": {
        "description": "Bold, distorted colours and aggressive brushwork.",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "pastel": {
        "description": "Soft chalky pastel tones with gentle blending.",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "charcoal": {
        "description": "Monochrome charcoal sketch with rough smudging.",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "ink_wash": {
        "description": "East Asian ink wash painting with flowing, transparent tones.",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "pointillism": {
        "description": "Thousands of tiny coloured dots that blend at distance (Seurat style).",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "ukiyo_e": {
        "description": "Japanese woodblock print aesthetics — flat colour areas with bold outlines.",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "abstract_kandinsky": {
        "description": "Vivid geometric abstraction inspired by Wassily Kandinsky.",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "graffiti": {
        "description": "Bold spray-paint graffiti with high saturation and sharp edges.",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    "marble": {
        "description": "Veined marble stone surface with smooth gradients.",
        "category": "neural_adain",
        "tiers_supported": [2, 12],
        "requires_drawing": False,
        "instant": False,
    },
    # ── Cartoon-family (computational — no weights needed) ────────────────
    "cartoon": {
        "description": "Flat colour regions with bold black outlines — classic cartoon look.",
        "category": "cartoon",
        "tiers_supported": [1, 2, 12],
        "requires_drawing": False,
        "instant": True,
    },
    "anime": {
        "description": "Soft cel-shading with gentle edge tinting and boosted saturation.",
        "category": "cartoon",
        "tiers_supported": [1, 2, 12],
        "requires_drawing": False,
        "instant": True,
    },
    "cel_shading": {
        "description": "Hard discrete shading bands with thick dilated outlines.",
        "category": "cartoon",
        "tiers_supported": [1, 2, 12],
        "requires_drawing": False,
        "instant": True,
    },
    # ── Algorithmic filter effects (no training needed) ───────────────────
    "pixel_art": {
        "description": "Retro 8-bit pixelated look with quantised palette.",
        "category": "algorithmic",
        "tiers_supported": [1, 2, 12],
        "requires_drawing": False,
        "instant": True,
    },
    "low_poly": {
        "description": "Geometric low-polygon triangulation with flat filled faces.",
        "category": "algorithmic",
        "tiers_supported": [1, 2, 12],
        "requires_drawing": False,
        "instant": True,
    },
    "sepia": {
        "description": "Warm vintage sepia tone — old photograph aesthetic.",
        "category": "algorithmic",
        "tiers_supported": [1, 2, 12],
        "requires_drawing": False,
        "instant": True,
    },
    "vaporwave": {
        "description": "Retro-futurist purple/cyan colour grade with high saturation.",
        "category": "algorithmic",
        "tiers_supported": [1, 2, 12],
        "requires_drawing": False,
        "instant": True,
    },
    "cyberpunk_neon": {
        "description": "Dark base with vivid neon highlights and Gaussian bloom.",
        "category": "algorithmic",
        "tiers_supported": [1, 2, 12],
        "requires_drawing": False,
        "instant": True,
    },
}

# ── Trained feed-forward weight files ────────────────────────────────────────
# These 5 styles have .pt weights in models/. All others fall back to AdaIN.
TRAINED_FF_STYLES = {"watercolor", "crayon", "oil_painting", "van_gogh", "mosaic"}


def load_catalog() -> dict:
    """Load the GLB asset catalog from disk."""
    if not CATALOG_PATH.exists():
        return {}
    return json.loads(CATALOG_PATH.read_text())


def resolve_model_path(category: str, name: str) -> Path | None:
    """Resolve a catalog entry (category + name) to an absolute GLB path."""
    catalog = load_catalog()
    cat = catalog.get(category, {})
    entry = cat.get(name)
    if entry is None:
        return None
    rel = entry.get("glb", "")
    path = GLB_DIR / rel
    return path if path.exists() else None


def resolve_class_name(class_name: str) -> tuple[str, str, Path] | None:
    """Find a model by classifier class name, searching all categories.

    The classifier outputs a flat name like 'cat' or 'A'. This searches
    every category in the catalog and returns (category, name, glb_path)
    for the first match, or None if not found.
    """
    catalog = load_catalog()
    # Case-insensitive match
    target = class_name.strip().lower()
    for category, entries in catalog.items():
        if category.startswith("_") or not isinstance(entries, dict):
            continue
        for name, info in entries.items():
            if name.lower() == target and isinstance(info, dict):
                path = GLB_DIR / info.get("glb", "")
                if path.exists():
                    return category, name, path
    return None


def list_all_classes() -> list[dict]:
    """Return every classifier-recognizable class name across all categories."""
    catalog = load_catalog()
    classes = []
    for category, entries in catalog.items():
        if category.startswith("_") or not isinstance(entries, dict):
            continue
        for name, info in entries.items():
            if isinstance(info, dict):
                classes.append({
                    "class_name": name,
                    "category": category,
                    "material_type": info.get("material_type"),
                    "animated": info.get("animated", False),
                })
    return classes

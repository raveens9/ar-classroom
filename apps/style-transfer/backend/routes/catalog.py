"""GET /help    — full usage guide (styles, models, examples).
   GET /styles  — list available style presets.
   GET /models  — list available 3D models from the GLB catalog.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/styles", summary="List all available style presets")
def list_styles() -> dict:
    """Returns all 24 style presets with category, description, and supported tiers.

    Categories:
    - **palette**         – colour-only, no ML (instant)
    - **neural_trained**  – feed-forward network with pre-trained weights
    - **neural_adain**    – optimization-based AdaIN (slower, ~10–30 s per texture)
    - **cartoon**         – computational cartoon effects (instant)
    - **algorithmic**     – filter-based effects (instant)
    """
    from backend.config import STYLE_CATALOGUE, MODELS_DIR, TRAINED_FF_STYLES

    styles = []
    for name, meta in STYLE_CATALOGUE.items():
        entry = {"name": name, **meta}
        # Annotate whether trained weights are available on disk
        if name in TRAINED_FF_STYLES:
            entry["weights_available"] = (MODELS_DIR / f"{name}.pt").exists()
        else:
            entry["weights_available"] = None  # not applicable
        styles.append(entry)

    by_category: dict[str, list] = {}
    for s in styles:
        by_category.setdefault(s["category"], []).append(s)

    return {
        "total": len(styles),
        "styles": styles,
        "by_category": by_category,
    }


@router.get("/models", summary="List available 3D models from the catalog")
def list_models() -> dict:
    """Returns all GLB models in the catalog, grouped by category.

    Each entry shows the model key, GLB path, material type, and whether
    it has animations. Use the **category** + **name** in the
    `POST /stylize/by-name` endpoint.
    """
    from backend.config import load_catalog, GLB_DIR

    raw = load_catalog()

    result: dict[str, list] = {}
    for category, entries in raw.items():
        if category.startswith("_"):
            continue
        models = []
        for name, info in entries.items():
            if isinstance(info, dict):
                models.append({
                    "name": name,
                    "category": category,
                    "glb": info.get("glb"),
                    "material_type": info.get("material_type"),
                    "animated": info.get("animated", False),
                    "file_exists": (GLB_DIR / info.get("glb", "")).exists(),
                })
        result[category] = models

    total = sum(len(v) for v in result.values())
    return {"total": total, "models": result}


@router.get(
    "/models/{category}/{name}",
    summary="Get details for a single model",
)
def get_model(category: str, name: str) -> dict:
    """Returns full catalog entry for one model including variant paths."""
    from backend.config import load_catalog, GLB_DIR

    raw = load_catalog()
    cat = raw.get(category)
    if cat is None:
        raise HTTPException(status_code=404, detail=f"Category '{category}' not found.")
    entry = cat.get(name)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{name}' not found in category '{category}'.",
        )
    return {
        "category": category,
        "name": name,
        "file_exists": (GLB_DIR / entry.get("glb", "")).exists(),
        **entry,
    }


@router.get("/classes", summary="All classifier-recognizable class names")
def list_classes() -> dict:
    """Returns every class name the classifier can output that this backend supports.

    Use these values as `class_name` in `POST /stylize/by-class`.
    Each entry shows which catalog category the class belongs to.
    """
    from backend.config import list_all_classes
    classes = list_all_classes()
    names = [c["class_name"] for c in classes]
    return {
        "total": len(classes),
        "class_names": names,
        "details": classes,
    }


@router.get("/help", summary="Full usage guide — styles, models, and request examples")
def help_guide() -> dict:
    """One-stop reference for using this API.

    Returns:
    - What this service does
    - All available styles grouped by category
    - All available 3D models grouped by category
    - Explanation of the three method tiers
    - Ready-to-use example requests for every endpoint
    """
    from backend.config import STYLE_CATALOGUE, MODELS_DIR, TRAINED_FF_STYLES, load_catalog, GLB_DIR

    # ── Styles ───────────────────────────────────────────────────────────────
    styles_by_category: dict[str, list] = {}
    for name, meta in STYLE_CATALOGUE.items():
        entry = {
            "name": name,
            "description": meta["description"],
            "tiers_supported": meta["tiers_supported"],
            "instant": meta["instant"],
        }
        if name in TRAINED_FF_STYLES:
            entry["weights_ready"] = (MODELS_DIR / f"{name}.pt").exists()
        styles_by_category.setdefault(meta["category"], []).append(entry)

    # ── Models ───────────────────────────────────────────────────────────────
    raw_catalog = load_catalog()
    models_by_category: dict[str, list] = {}
    for category, entries in raw_catalog.items():
        if category.startswith("_"):
            continue
        for name, info in entries.items():
            if isinstance(info, dict):
                models_by_category.setdefault(category, []).append({
                    "name": name,
                    "material_type": info.get("material_type"),
                    "animated": info.get("animated", False),
                })

    # ── Style name lists (compact, for quick lookup) ──────────────────────
    instant_styles = [n for n, m in STYLE_CATALOGUE.items() if m["instant"]]
    neural_styles  = [n for n, m in STYLE_CATALOGUE.items() if not m["instant"]]

    return {
        "service": "AI Style Transfer API",
        "version": "2.0.0",
        "description": (
            "Restyle a 3D .glb model so its colours and visual style match "
            "a child's drawing. Send a drawing image and get back a styled .glb "
            "ready for AR display."
        ),

        # ── Tiers ────────────────────────────────────────────────────────────
        "tiers": {
            "1": {
                "name": "Tier 1 — Palette Transfer",
                "description": (
                    "Transfers the colour distribution of the child's drawing "
                    "onto the 3D model using histogram matching. Fast (~1–3 s), "
                    "always available, colour-accurate."
                ),
                "speed": "~1–3 seconds",
                "best_for": "Colour accuracy, quick results",
                "use": "tier=1",
            },
            "2": {
                "name": "Tier 2 — Neural Style Transfer",
                "description": (
                    "Applies artistic neural style to the model's UV textures. "
                    "Uses a feed-forward network (fast presets) or AdaIN optimisation. "
                    "Cartoon and algorithmic sub-styles are instant even at tier 2."
                ),
                "speed": "Instant (cartoon/algo) · 2–5 s (trained presets) · 10–30 s (AdaIN)",
                "best_for": "Artistic quality, visual style",
                "use": "tier=2",
            },
            "12": {
                "name": "Tier 12 — Chained (Tier 1 → Tier 2)",
                "description": (
                    "Runs Tier 1 first to shift the model colours toward the "
                    "child's drawing palette, then applies Tier 2 neural style on "
                    "top. Best of both: colour accuracy AND artistic quality."
                ),
                "speed": "Tier 1 time + Tier 2 time",
                "best_for": "Best overall output — recommended for child_colors + any neural style",
                "use": "tier=12",
            },
        },

        # ── Available styles ─────────────────────────────────────────────────
        "available_styles": {
            "instant_styles": instant_styles,
            "neural_styles": neural_styles,
            "by_category": styles_by_category,
        },

        # ── Available models ─────────────────────────────────────────────────
        "available_models": models_by_category,

        # ── Endpoints ────────────────────────────────────────────────────────
        "endpoints": [
            {
                "method": "GET",
                "path": "/help",
                "description": "This guide — styles, models, tiers, and request examples.",
            },
            {
                "method": "GET",
                "path": "/health",
                "description": "Service liveness check, device info, loaded model weights.",
            },
            {
                "method": "GET",
                "path": "/styles",
                "description": "Full list of all 24 style presets with metadata.",
            },
            {
                "method": "GET",
                "path": "/models",
                "description": "All 3D models in the catalog, grouped by category.",
            },
            {
                "method": "GET",
                "path": "/models/{category}/{name}",
                "description": "Details for one model. Example: /models/animals/cat",
            },
            {
                "method": "POST",
                "path": "/stylize/multi",
                "description": (
                    "⭐ RECOMMENDED — Sequential style pipeline. "
                    "Provide class_name + drawing and/or styles. "
                    "Always returns ONE final .glb (never a ZIP). "
                    "See 'stylize_multi_pipeline' field below for full behaviour table."
                ),
                "content_type": "multipart/form-data",
                "fields": {
                    "class_name": "str   — classifier output, e.g. cat (default: cat)",
                    "styles":     "str   — comma-separated Tier-2 style names, e.g. 'watercolor,cartoon' (default: empty)",
                    "intensity":  "float — blend strength 0.0–1.0 (default: 0.8)",
                    "drawing":    "file  — PNG or JPEG drawing (OPTIONAL — omit when using styles without colour-matching)",
                },
                "behaviour": {
                    "drawing only":          "child_colors (Tier 1) → 1 GLB",
                    "drawing + styles":      "child_colors → style1 → style2 → ... → 1 final GLB",
                    "styles only":           "style1 → style2 → ... → 1 final GLB (no colour step)",
                    "neither":               "Error — provide a drawing, styles, or both",
                },
                "extra_response_headers": {
                    "X-Pipeline":       "Exact steps that ran, e.g. 'child_colors -> watercolor -> cartoon'",
                    "X-Model-Name":     "Model matched from catalog",
                    "X-Model-Category": "Catalog category of the matched model",
                },
            },
            {
                "method": "POST",
                "path": "/stylize/by-class",
                "description": (
                    "Single-style endpoint — classifier class name + drawing → styled .glb. "
                    "Use /stylize/multi for chaining multiple styles."
                ),
                "content_type": "multipart/form-data",
                "fields": {
                    "drawing":      "file  — PNG or JPEG drawing (required)",
                    "class_name":   "str   — classifier output, e.g. cat, dog, A (default: cat)",
                    "style_choice": "str   — style name (default: child_colors)",
                    "intensity":    "float — blend strength 0.0–1.0 (default: 0.8)",
                    "tier":         "int   — 1, 2, or 12 (default: 1)",
                },
            },
            {
                "method": "POST",
                "path": "/stylize/by-name",
                "description": "Pick a model by explicit category + name + drawing → styled .glb.",
                "content_type": "multipart/form-data",
                "fields": {
                    "drawing":        "file  — PNG or JPEG drawing (required)",
                    "model_category": "str   — catalog category, e.g. animals (default: animals)",
                    "model_name":     "str   — model key, e.g. cat (default: cat)",
                    "style_choice":   "str   — style name (default: child_colors)",
                    "intensity":      "float — blend strength 0.0–1.0 (default: 0.8)",
                    "tier":           "int   — 1, 2, or 12 (default: 1)",
                },
            },
            {
                "method": "POST",
                "path": "/stylize",
                "description": "Upload your own .glb + a drawing → styled .glb.",
                "content_type": "multipart/form-data",
                "fields": {
                    "base_model":   "file  — .glb 3D model (required)",
                    "drawing":      "file  — PNG or JPEG drawing (required)",
                    "style_choice": "str   — style name (default: child_colors)",
                    "intensity":    "float — blend strength 0.0–1.0 (default: 0.8)",
                    "tier":         "int   — 1, 2, or 12 (default: 1)",
                },
            },
            {
                "method": "GET",
                "path": "/classes",
                "description": "All class names the classifier can output that this backend supports.",
            },
            {
                "method": "POST",
                "path": "/stylize/preview",
                "description": "Extract dominant colours from a drawing (no 3D model needed).",
                "content_type": "multipart/form-data",
                "fields": {
                    "drawing": "file — PNG or JPEG drawing (required)",
                    "k":       "int  — number of colours to extract, 2–12 (default: 6)",
                },
            },
        ],

        # ── /stylize/multi pipeline behaviour (detailed) ──────────────────────
        "stylize_multi_pipeline": {
            "summary": (
                "POST /stylize/multi runs styles sequentially — output of each step "
                "becomes the input of the next. Always returns one final .glb."
            ),
            "inputs": {
                "class_name": "Classifier output e.g. 'cat' — backend finds the GLB automatically",
                "drawing":    "Child's drawing image (OPTIONAL)",
                "styles":     "Comma-separated Tier-2 style names (OPTIONAL)",
                "intensity":  "Blend strength 0.0–1.0",
            },
            "pipeline_table": [
                {
                    "drawing": "provided",
                    "styles": "empty",
                    "pipeline": "child_colors (Tier 1)",
                    "output": "GLB with drawing colours applied",
                },
                {
                    "drawing": "provided",
                    "styles": "watercolor",
                    "pipeline": "child_colors -> watercolor",
                    "output": "Drawing colours + watercolour style",
                },
                {
                    "drawing": "provided",
                    "styles": "watercolor,cartoon",
                    "pipeline": "child_colors -> watercolor -> cartoon",
                    "output": "Drawing colours + watercolour + cartoon on top",
                },
                {
                    "drawing": "not provided",
                    "styles": "watercolor",
                    "pipeline": "watercolor (Tier 2 only)",
                    "output": "Watercolour style, original model colours kept",
                },
                {
                    "drawing": "not provided",
                    "styles": "watercolor,cartoon",
                    "pipeline": "watercolor -> cartoon",
                    "output": "Watercolour then cartoon chained, no colour step",
                },
            ],
            "response_headers": {
                "X-Pipeline":          "Exact steps, e.g. 'child_colors -> watercolor -> cartoon'",
                "X-Style-Applied":     "Same as X-Pipeline",
                "X-Tier-Used":         "1, 2, or 12 (chained)",
                "X-Processing-Time-S": "Total wall-clock seconds for all steps",
                "X-Model-Name":        "Model matched from the class_name lookup",
                "X-Model-Category":    "Catalog category of the matched model",
            },
        },

        # ── Ready-to-copy request examples ───────────────────────────────────
        "examples": {
            "1_drawing_only": {
                "description": "Drawing only — apply child's colours to the model (Tier 1, ~1–3 s)",
                "curl": (
                    'curl -X POST http://localhost:8000/stylize/multi \\\n'
                    '  -F "class_name=cat" \\\n'
                    '  -F "drawing=@cat_drawing.png" \\\n'
                    '  --output cat_colored.glb'
                ),
                "pipeline": "child_colors",
            },
            "2_drawing_plus_one_style": {
                "description": "Drawing + one style — colour-match then watercolour neural style",
                "curl": (
                    'curl -X POST http://localhost:8000/stylize/multi \\\n'
                    '  -F "class_name=cat" \\\n'
                    '  -F "drawing=@cat_drawing.png" \\\n'
                    '  -F "styles=watercolor" \\\n'
                    '  --output cat_watercolor.glb'
                ),
                "pipeline": "child_colors -> watercolor",
            },
            "3_drawing_plus_multiple_styles": {
                "description": "Drawing + multiple styles — full pipeline chain (best quality)",
                "curl": (
                    'curl -X POST http://localhost:8000/stylize/multi \\\n'
                    '  -F "class_name=cat" \\\n'
                    '  -F "drawing=@cat_drawing.png" \\\n'
                    '  -F "styles=watercolor,cartoon" \\\n'
                    '  --output cat_final.glb'
                ),
                "pipeline": "child_colors -> watercolor -> cartoon",
            },
            "4_styles_only_no_drawing": {
                "description": "Styles only (no drawing) — apply style directly to original model",
                "curl": (
                    'curl -X POST http://localhost:8000/stylize/multi \\\n'
                    '  -F "class_name=dog" \\\n'
                    '  -F "styles=watercolor,cartoon" \\\n'
                    '  --output dog_styled.glb'
                ),
                "pipeline": "watercolor -> cartoon",
            },
            "5_real_world_web_app": {
                "description": (
                    "Real-world web app integration — classifier predicts 'cat', "
                    "web app sends the drawing and gets back a styled .glb for AR"
                ),
                "javascript_fetch": (
                    "canvas.toBlob(async (blob) => {\n"
                    "  const form = new FormData();\n"
                    "  form.append('class_name', predictedClass);   // from classifier\n"
                    "  form.append('drawing', blob, 'drawing.png'); // child's canvas\n"
                    "  form.append('styles', 'watercolor');          // optional style\n"
                    "\n"
                    "  const res = await fetch('http://BACKEND_IP:8000/stylize/multi', {\n"
                    "    method: 'POST', body: form\n"
                    "  });\n"
                    "  const glbBlob = await res.blob();\n"
                    "  arViewer.src = URL.createObjectURL(glbBlob);\n"
                    "}, 'image/png');"
                ),
                "pipeline": "child_colors -> watercolor",
            },
            "6_palette_preview": {
                "description": "Extract colours from a drawing before styling",
                "curl": (
                    'curl -X POST http://localhost:8000/stylize/preview \\\n'
                    '  -F "drawing=@cat_drawing.png" \\\n'
                    '  -F "k=6"'
                ),
            },
        },

        # ── Response headers on stylize endpoints ─────────────────────────────
        "response_headers": {
            "X-Style-Applied":     "Style or pipeline that ran, e.g. 'child_colors -> watercolor'",
            "X-Pipeline":          "Same as X-Style-Applied (on /stylize/multi only)",
            "X-Tier-Used":         "Tier number and label, e.g. '12 (chained)'",
            "X-Processing-Time-S": "Wall-clock seconds taken",
            "X-Model-Name":        "Matched model name (on /stylize/by-class and /stylize/multi)",
            "X-Model-Category":    "Matched model category (on /stylize/by-class and /stylize/multi)",
            "Content-Type":        "application/octet-stream",
            "Content-Disposition": "attachment; filename=styled_model.glb",
        },

        "interactive_docs": "http://localhost:8000/docs",
    }

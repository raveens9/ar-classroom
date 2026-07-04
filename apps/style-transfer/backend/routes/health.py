"""GET /health — service liveness and device info."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", summary="Health check")
def health() -> dict:
    """Returns service status and the compute device in use (mps / cpu)."""
    try:
        import torch
        if torch.backends.mps.is_available():
            device = "mps"
        elif torch.cuda.is_available():
            device = f"cuda ({torch.cuda.get_device_name(0)})"
        else:
            device = "cpu"
        torch_version = torch.__version__
    except ImportError:
        device = "unknown"
        torch_version = "not installed"

    from backend.config import MODELS_DIR, TRAINED_FF_STYLES
    trained = [s for s in TRAINED_FF_STYLES if (MODELS_DIR / f"{s}.pt").exists()]

    return {
        "status": "ok",
        "device": device,
        "torch_version": torch_version,
        "trained_styles_loaded": trained,
        "trained_styles_count": len(trained),
    }

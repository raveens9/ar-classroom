"""FastAPI backend — AI Style Transfer Service.

Endpoints:
  GET  /health                 — liveness + device info
  GET  /styles                 — list all 24 style presets
  GET  /models                 — list all GLB models from catalog
  GET  /models/{category}/{name} — single model details
  POST /stylize                — upload GLB + drawing → styled GLB
  POST /stylize/by-name        — catalog model + drawing → styled GLB
  POST /stylize/preview        — extract colour palette from drawing

Run:
  cd <repo-root>
  uvicorn backend.app:app --reload --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from backend.config import ALLOWED_ORIGINS
from backend.routes import health, catalog, stylize

app = FastAPI(
    title="AI Style Transfer API",
    description=(
        "Restyle .glb 3D models to match a child's drawing.\n\n"
        "**Three methods available:**\n"
        "- **Tier 1** (`tier=1`) — Palette transfer via histogram matching. "
        "Fast (~1–3 s), colour-accurate, always available.\n"
        "- **Tier 2** (`tier=2`) — Neural style transfer (AdaIN or feed-forward). "
        "Artistic quality, slower (~5–30 s). Cartoon and algorithmic sub-styles "
        "are instant even at tier 2.\n"
        "- **Chained** (`tier=12`) — Tier 1 then Tier 2. Best combination: "
        "colour-correct palette + artistic texture.\n\n"
        "**Quick start for teammates:** use `POST /stylize/by-name` with the "
        "classifier's predicted class name (e.g. `model_name=cat`) and upload "
        "the child's drawing. No GLB file needed."
    ),
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router,  tags=["Status"])
app.include_router(catalog.router, tags=["Catalog"])
app.include_router(stylize.router, tags=["Style Transfer"])


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/help")

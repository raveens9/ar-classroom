"""ML API — FastAPI service that backs the teacher tool palette.

Endpoints (all under /v1):
  POST /remove-background        — subject isolation on the current canvas export
  POST /classify                 — dummy classifier (random label + confidence)
  POST /prepare-texture-model    — bake texture onto the chosen base model
  POST /approve-generate-ar      — produce the final AR manifest the teacher publishes

HTTPS: enabled when TLS_ENABLED=true and cert paths exist; otherwise falls back to HTTP.
Static assets (baked models, textures, cutouts) are served from /static and referenced
through MODEL_ASSET_BASE_URL so URLs work on mobile over LAN.
"""
from __future__ import annotations

import os
import ssl
import uuid
import random
import logging
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routes import remove_bg, classify, prepare_texture, approve_generate, stylize

load_dotenv()

logging.basicConfig(level=logging.INFO, format="[ml-api] %(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ml-api")

APP_ROOT = Path(__file__).parent.resolve()
STATIC_DIR = APP_ROOT / "app" / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "cutouts").mkdir(exist_ok=True)
(STATIC_DIR / "models").mkdir(exist_ok=True)
(STATIC_DIR / "textures").mkdir(exist_ok=True)
(STATIC_DIR / "styled").mkdir(exist_ok=True)

app = FastAPI(title="AR Platform ML API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev only; tighten in prod
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

app.include_router(remove_bg.router, prefix="/v1")
app.include_router(classify.router, prefix="/v1")
app.include_router(prepare_texture.router, prefix="/v1")
app.include_router(approve_generate.router, prefix="/v1")
app.include_router(stylize.router, prefix="/v1")


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "service": "ml-api", "request_id": str(uuid.uuid4())}


def _ssl_context() -> ssl.SSLContext | None:
    if os.getenv("TLS_ENABLED", "true").lower() != "true":
        return None
    key = os.getenv("TLS_KEY_PATH", "../../certs/dev-key.pem")
    cert = os.getenv("TLS_CERT_PATH", "../../certs/dev-cert.pem")
    key_p = Path(key).resolve()
    cert_p = Path(cert).resolve()
    if not key_p.exists() or not cert_p.exists():
        log.warning("TLS enabled but certs missing (key=%s cert=%s); falling back to HTTP", key_p, cert_p)
        return None
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(cert_p), keyfile=str(key_p))
    return ctx


if __name__ == "__main__":
    # Prefer `uvicorn main:app` from CLI; this block is a convenience entrypoint.
    import uvicorn

    port = int(os.getenv("ML_API_PORT", "8000"))
    ctx = _ssl_context()
    if ctx is None:
        uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
    else:
        uvicorn.run(
            "main:app",
            host="0.0.0.0",
            port=port,
            reload=True,
            ssl_keyfile=os.getenv("TLS_KEY_PATH", "../../certs/dev-key.pem"),
            ssl_certfile=os.getenv("TLS_CERT_PATH", "../../certs/dev-cert.pem"),
        )

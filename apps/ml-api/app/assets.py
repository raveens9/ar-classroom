"""Asset URL helpers. Keeps URL construction in one place so host rewriting works."""
from __future__ import annotations
import os


def asset_base() -> str:
    """Base URL for assets the ML API serves itself (cutouts, mirrored textures)."""
    return os.getenv("MODEL_ASSET_BASE_URL", "https://localhost:8000/static").rstrip("/")


def static_url(path: str) -> str:
    return f"{asset_base()}/{path.lstrip('/')}"


def web_public_base() -> str:
    """Base URL for files the web app serves from its /public folder.

    We point modelUrls here so .glb files don't have to be duplicated between
    apps/web/public and apps/ml-api/app/static. Defaults to localhost:3000; on a LAN
    phone the client-side rewriteHost() swaps localhost → device hostname.
    """
    return os.getenv("WEB_PUBLIC_BASE_URL", "https://localhost:3000").rstrip("/")


def public_model_url(path: str) -> str:
    return f"{web_public_base()}/{path.lstrip('/')}"

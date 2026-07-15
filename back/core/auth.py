"""Authentication dependencies for mutating/admin endpoints (SEC-013).

Contract:
  - Header: ``X-API-Key``.
  - When ``settings.api_key`` is empty and env != "prod" → open (local dev).
  - When ``settings.api_key`` is set (any env) → the header is required and
    compared with ``secrets.compare_digest`` (constant-time).
  - In prod an empty ``API_KEY`` is a deployment error: main.py refuses to
    start. This dependency still denies as defence-in-depth.
"""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Header

from core.config import get_settings
from core.errors import Unauthorized


def require_api_key(
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> None:
    """FastAPI dependency guarding mutating/admin endpoints (SEC-013)."""
    settings = get_settings()

    if not settings.api_key:
        if settings.env != "prod":
            # Local development convenience: no key configured → open.
            return
        # Should be unreachable (main.py refuses to start in prod without a
        # key), but never fail open in production.
        raise Unauthorized("API key is not configured on the server.")

    if not x_api_key or not secrets.compare_digest(x_api_key, settings.api_key):
        raise Unauthorized("Invalid or missing X-API-Key header.")

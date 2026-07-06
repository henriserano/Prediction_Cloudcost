"""Session cookie helpers.

Design:
- JWT (HS256) stored in an httpOnly cookie. The frontend never touches it
  and can't read the user id from JS — only the backend can decode it.
- Payload is minimal: ``sub`` (user_id), ``exp``, ``iat``. Everything else
  (display name, has_password, etc.) is fetched fresh from DynamoDB per
  request via ``get_current_user`` — the JWT is a proof of identity, not a
  cache of user data.
- When ``settings.session_secret`` is empty in dev, we generate an ephemeral
  key at process start. It means every uvicorn restart invalidates all
  sessions — acceptable trade-off vs shipping a default-known key.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Cookie, Request

from core.config import get_settings
from core.errors import Unauthorized


_ALGO = "HS256"


_ephemeral_secret: str | None = None


def _signing_key() -> str:
    """Return the effective HS256 signing key. Generates an ephemeral one in
    dev when ``SESSION_SECRET`` is not set."""
    settings = get_settings()
    if settings.session_secret:
        return settings.session_secret
    global _ephemeral_secret
    if _ephemeral_secret is None:
        _ephemeral_secret = secrets.token_urlsafe(32)
    return _ephemeral_secret


def issue_session(user_id: str) -> str:
    """Return a signed JWT for ``user_id``."""
    settings = get_settings()
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.session_ttl_hours)).timestamp()),
    }
    return jwt.encode(payload, _signing_key(), algorithm=_ALGO)


def decode_session(token: str) -> Optional[str]:
    """Return the user_id in the JWT, or None if invalid / expired."""
    try:
        payload = jwt.decode(token, _signing_key(), algorithms=[_ALGO])
        sub = payload.get("sub")
        if isinstance(sub, str) and sub:
            return sub
        return None
    except jwt.InvalidTokenError:
        return None


def get_current_user_id(request: Request) -> Optional[str]:
    """Read the sid cookie and return the associated user_id, or None."""
    cookie_name = get_settings().session_cookie_name
    token = request.cookies.get(cookie_name)
    if not token:
        return None
    return decode_session(token)


def require_current_user_id(request: Request) -> str:
    """FastAPI dependency: same as get_current_user_id but raises 401."""
    uid = get_current_user_id(request)
    if not uid:
        raise Unauthorized("Not authenticated. Please log in.")
    return uid

"""Response schemas for /health and /admin/cache/*."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    cache: dict[str, Any]
    data: dict[str, Any]


class CacheClearResponse(BaseModel):
    status: str
    cache: dict[str, Any]

from __future__ import annotations

from fastapi import APIRouter, Depends

from core.auth import require_api_key
from core.cache import app_cache
from data.loader import get_data_fingerprint
from schemas.health import CacheClearResponse, HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        cache=app_cache.stats(),
        data=get_data_fingerprint(),
    )


@router.post(
    "/admin/cache/clear",
    include_in_schema=False,
    dependencies=[Depends(require_api_key)],
    response_model=CacheClearResponse,
)
def clear_cache() -> CacheClearResponse:
    """Flush result cache and reload parquet files. Internal use only (SEC-013)."""
    from data.loader import invalidate_cache, load_daily_costs, load_daily_per_service

    app_cache.clear()
    invalidate_cache()
    load_daily_costs()
    load_daily_per_service()
    return CacheClearResponse(status="cleared", cache=app_cache.stats())

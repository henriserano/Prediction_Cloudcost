from __future__ import annotations

from fastapi import APIRouter

from core.cache import app_cache
from data.loader import get_data_fingerprint

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {
        "status": "ok",
        "cache": app_cache.stats(),
        "data": get_data_fingerprint(),
    }


@router.post("/admin/cache/clear", include_in_schema=False)
def clear_cache():
    """Flush result cache and reload parquet files. Internal use only."""
    from data.loader import invalidate_cache, load_daily_costs, load_daily_per_service
    app_cache.clear()
    invalidate_cache()
    load_daily_costs()
    load_daily_per_service()
    return {"status": "cleared", "cache": app_cache.stats()}

from __future__ import annotations

import asyncio
import concurrent.futures
import time
from collections.abc import Callable
from typing import Any

from core.logging import get_logger
from core.user_context import reset_current_user_id, set_current_user_id

logger = get_logger(__name__)

# Labels for the warm-up tasks (observability only — every compute function
# below caches its own result internally under a user-scoped key, see
# core.cache.scoped_key). Startup precompute runs with NO authenticated user,
# so everything lands in the anonymous scope and can never shadow a real
# user's data. Honest trade-off: authenticated routes read their own scope,
# so each user pays the compute once at first read (then cache); the warm-up's
# main value is exercising the full pipeline at boot (timings + failures
# logged) and pre-filling the anonymous/demo slot. Sharing the demo results
# across data-less users would need provenance-scoped keys — follow-up.
CACHE_KEYS = {
    "kpi": "analytics:kpi",
    "services": "analytics:services",
    "daily": "analytics:daily",
    "stats": "analytics:stats",
    "anomalies": "analytics:anomalies:2.0",
    "stationarity": "analytics:stationarity",
    "stl": "analytics:stl",
    "acf": "analytics:acf:28",
    "benchmarks": "forecast:benchmarks",
}

DEFAULT_FORECAST_HORIZONS = [30, 60, 90]


def forecast_cache_key(model: str, horizon: int) -> str:
    return f"forecast:{model}:{horizon}"


def _run_task(key: str, fn: Callable) -> tuple[str, float, bool]:
    # SEC-020: pin the anonymous scope explicitly. Executor threads have an
    # empty ContextVar context anyway, but a future refactor to a
    # context-propagating runner (anyio.to_thread) must not silently warm the
    # cache under whichever user happened to trigger it.
    token = set_current_user_id(None)
    t0 = time.perf_counter()
    try:
        # Each compute function stores its own result under its scoped cache
        # key — no explicit app_cache.set here, which would bypass scoping.
        fn()
        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.info("precomputed", extra={"key": key, "ms": round(elapsed_ms, 1)})
        return key, elapsed_ms, True
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        logger.error(
            "precompute_failed", extra={"key": key, "error": str(exc), "ms": round(elapsed_ms, 1)}
        )
        return key, elapsed_ms, False
    finally:
        reset_current_user_id(token)


async def warm_cache() -> dict[str, Any]:
    """Precompute all expensive results at startup using a thread pool.

    Imports are deferred to avoid circular-import issues at module load time.
    Returns a summary dict with timing info for observability.
    """
    from analysis.services import get_kpi, get_service_shares
    from analysis.timeseries import (
        get_acf_pacf,
        get_anomalies,
        get_daily_series,
        get_descriptive_stats,
        get_stationarity,
        get_stl_decomposition,
    )
    from forecast.engine import MODELS, get_forecast, get_model_benchmarks

    tasks: list[tuple[str, Callable]] = [
        (CACHE_KEYS["kpi"], get_kpi),
        (CACHE_KEYS["services"], get_service_shares),
        (CACHE_KEYS["daily"], get_daily_series),
        (CACHE_KEYS["stats"], get_descriptive_stats),
        (CACHE_KEYS["anomalies"], lambda: get_anomalies(2.0)),
        (CACHE_KEYS["stationarity"], get_stationarity),
        (CACHE_KEYS["stl"], get_stl_decomposition),
        (CACHE_KEYS["acf"], lambda: get_acf_pacf(28)),
        # Both CV-horizon buckets actually served: 14 (default /models table)
        # and 28 (the bucket every forecast with horizon >= 28 links to).
        (CACHE_KEYS["benchmarks"], get_model_benchmarks),
        ("forecast:benchmarks:28", lambda: get_model_benchmarks(28)),
    ]

    for model_name in MODELS:
        for h in DEFAULT_FORECAST_HORIZONS:
            key = forecast_cache_key(model_name, h)
            tasks.append((key, lambda m=model_name, hz=h: get_forecast(hz, m)))

    loop = asyncio.get_running_loop()

    with concurrent.futures.ThreadPoolExecutor(
        max_workers=4, thread_name_prefix="precompute"
    ) as pool:
        awaitables = [loop.run_in_executor(pool, _run_task, key, fn) for key, fn in tasks]
        outcomes: list[tuple[str, float, bool]] = await asyncio.gather(*awaitables)

    ok = sum(1 for _, _, success in outcomes if success)
    failed_keys = [k for k, _, s in outcomes if not s]

    logger.info(
        "cache_warm_complete",
        extra={
            "total": len(tasks),
            "ok": ok,
            "failed": len(failed_keys),
        },
    )
    if failed_keys:
        logger.warning("cache_warm_partial", extra={"failed_keys": failed_keys})

    return {
        "total": len(tasks),
        "ok": ok,
        "failed": failed_keys,
        "timings_ms": {k: round(ms, 1) for k, ms, _ in outcomes},
    }

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from core.config import get_settings

_DATA_DIR = Path(__file__).parent

_PARQUET_FILES = {
    "daily_costs": _DATA_DIR / "daily_costs.parquet",
    "daily_per_service": _DATA_DIR / "daily_per_service.parquet",
}

# Hard cap on the on-disk size of a demo parquet. The bundled files are ~200 KB;
# 32 MB leaves generous room for a moderately larger export while still
# refusing a gigabyte-scale file that would freeze uvicorn on load during
# startup or a background reload.
_MAX_PARQUET_BYTES = 32 * 1024 * 1024

_mtimes: dict[str, float] = {}

# PERF-001: single-flight cache. functools.lru_cache does NOT serialise the
# wrapped call body — N concurrent callers on a cold cache each spawn their own
# parquet parse. On startup, precompute() + the first user requests hit this
# path concurrently; without the lock we parsed the parquet 4-6 times back to
# back. Per-key threading.Lock + double-checked-read guarantees a single parse.
_load_cache: dict[str, pd.DataFrame] = {}
_load_locks: dict[str, threading.Lock] = {
    "daily_costs": threading.Lock(),
    "daily_per_service": threading.Lock(),
}


def _single_flight(key: str, build: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    """Return the cached DataFrame for ``key``, calling ``build`` only if it
    isn't cached yet — and only from one thread at a time (double-checked
    locking). The build result is stored back in ``_load_cache``."""
    cached = _load_cache.get(key)
    if cached is not None:
        return cached
    with _load_locks[key]:
        cached = _load_cache.get(key)
        if cached is not None:
            return cached
        built = build()
        _load_cache[key] = built
        return built

# Track which data source the most recent load resolved to so the /api/data/status
# endpoint (and callers who need to display provenance) can report it. Cleared
# by invalidate_cache() alongside the LRU caches.
_last_source: dict[str, str] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _daily_from_events(events_df: pd.DataFrame) -> pd.DataFrame:
    """Sum injected events per day → the (ds, y) schema used everywhere else."""
    if len(events_df) == 0:
        return pd.DataFrame(columns=["ds", "y"])
    df = events_df.groupby("ds", as_index=False)["Sous-total (€)"].sum()
    df = df.rename(columns={"Sous-total (€)": "y"})
    df["ds"] = pd.to_datetime(df["ds"])
    return df.sort_values("ds").reset_index(drop=True)


def _per_service_from_events(events_df: pd.DataFrame) -> pd.DataFrame:
    """Pivot injected events → (ds, service_A, service_B, ...) schema."""
    if len(events_df) == 0 or "service" not in events_df.columns:
        return pd.DataFrame(columns=["ds"])
    df = (
        events_df.pivot_table(
            index="ds",
            columns="service",
            values="Sous-total (€)",
            aggfunc="sum",
            fill_value=0.0,
        )
        .reset_index()
    )
    df.columns.name = None
    df["ds"] = pd.to_datetime(df["ds"])
    return df.sort_values("ds").reset_index(drop=True)


def _safe_read_parquet(path: Path) -> pd.DataFrame | None:
    """Read a parquet, refusing anything above _MAX_PARQUET_BYTES.

    Returning None (instead of raising) keeps startup resilient: a swapped-in
    oversized file logs a warning and falls back to the empty DataFrame path
    rather than blocking the FastAPI lifespan.
    """
    try:
        size = path.stat().st_size
    except OSError:
        return None
    if size > _MAX_PARQUET_BYTES:
        # Late import so we don't take a hard dep in module init.
        from core.logging import get_logger

        get_logger(__name__).warning(
            "parquet_rejected_oversized",
            extra={"path": str(path), "size_bytes": size, "limit": _MAX_PARQUET_BYTES},
        )
        return None
    return pd.read_parquet(path)


def _read_events_df() -> pd.DataFrame:
    """Return the current in-memory events DataFrame (empty if none).

    SEC-015: get_injected_events_df() snapshots the shared store under its
    lock, so this read is safe against concurrent mutations.
    """
    try:
        from routes.routes_events import get_injected_events_df

        return get_injected_events_df()
    except Exception:
        return pd.DataFrame(columns=["ds", "Sous-total (€)", "service"])


# ---------------------------------------------------------------------------
# Public loaders
# ---------------------------------------------------------------------------

def load_daily_costs() -> pd.DataFrame:
    """Daily aggregated costs (ds, y).

    Resolution order:
      1. Live data ingested via /api/events or /api/gcp/sync (real GCP data).
      2. Bundled parquet demo — only when ``DATA_ALLOW_PARQUET_FALLBACK=true``.
      3. Empty DataFrame — signals the frontend that no data has been synced yet.
    """

    def _build() -> pd.DataFrame:
        events_df = _read_events_df()
        if len(events_df) > 0:
            _last_source["daily_costs"] = "events"
            return _daily_from_events(events_df)

        if get_settings().data_allow_parquet_fallback:
            path = _PARQUET_FILES["daily_costs"]
            if path.exists():
                df = _safe_read_parquet(path)
                if df is not None:
                    df["ds"] = pd.to_datetime(df["ds"])
                    _mtimes["daily_costs"] = path.stat().st_mtime
                    _last_source["daily_costs"] = "parquet_fallback"
                    return df.sort_values("ds").reset_index(drop=True)

        _last_source["daily_costs"] = "empty"
        return pd.DataFrame(columns=["ds", "y"])

    return _single_flight("daily_costs", _build)


def load_daily_per_service() -> pd.DataFrame:
    """Daily costs broken down by service (ds, Service1, Service2, ...).

    Same resolution order as ``load_daily_costs``.
    """

    def _build() -> pd.DataFrame:
        events_df = _read_events_df()
        if len(events_df) > 0:
            _last_source["daily_per_service"] = "events"
            return _per_service_from_events(events_df)

        if get_settings().data_allow_parquet_fallback:
            path = _PARQUET_FILES["daily_per_service"]
            if path.exists():
                df = _safe_read_parquet(path)
                if df is not None:
                    df["ds"] = pd.to_datetime(df["ds"])
                    _mtimes["daily_per_service"] = path.stat().st_mtime
                    _last_source["daily_per_service"] = "parquet_fallback"
                    return df.sort_values("ds").reset_index(drop=True)

        _last_source["daily_per_service"] = "empty"
        return pd.DataFrame(columns=["ds"])

    return _single_flight("daily_per_service", _build)


def invalidate_cache() -> None:
    """Clear the single-flight cache for both loaders and reset provenance."""
    # Acquire both locks so a concurrent load_* call cannot slip a stale value
    # into the cache while we clear it.
    with _load_locks["daily_costs"], _load_locks["daily_per_service"]:
        _load_cache.clear()
        _mtimes.clear()
        _last_source.clear()


def get_last_source() -> dict[str, str]:
    """Return the source of the most recent successful load per dataset.

    Values: ``"events"`` (live data), ``"parquet_fallback"`` (bundled demo),
    ``"empty"`` (nothing loaded), or missing key if the loader hasn't been
    called since the last cache invalidation.
    """
    return dict(_last_source)


def get_data_fingerprint() -> dict[str, Any]:
    """Return current mtime + size for each parquet file — used by /health."""
    return {
        name: {
            "mtime": path.stat().st_mtime if path.exists() else None,
            "size_bytes": path.stat().st_size if path.exists() else None,
        }
        for name, path in _PARQUET_FILES.items()
    }


def reload_if_changed() -> bool:
    """Check parquet mtimes; if changed, clear LRU + app_cache and return True.

    Only meaningful when ``DATA_ALLOW_PARQUET_FALLBACK=true``; otherwise the
    parquet files are ignored anyway.
    """
    if not get_settings().data_allow_parquet_fallback:
        return False

    changed = False
    for name, path in _PARQUET_FILES.items():
        if not path.exists():
            continue
        current_mtime = path.stat().st_mtime
        if _mtimes.get(name) != current_mtime:
            changed = True
            break

    if changed:
        invalidate_cache()
        from core.cache import app_cache
        app_cache.clear()

    return changed

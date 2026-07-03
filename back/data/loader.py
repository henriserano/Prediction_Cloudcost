from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd

from core.config import get_settings

_DATA_DIR = Path(__file__).parent

_PARQUET_FILES = {
    "daily_costs": _DATA_DIR / "daily_costs.parquet",
    "daily_per_service": _DATA_DIR / "daily_per_service.parquet",
}

_mtimes: dict[str, float] = {}

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

@lru_cache(maxsize=1)
def load_daily_costs() -> pd.DataFrame:
    """Daily aggregated costs (ds, y).

    Resolution order:
      1. Live data ingested via /api/events or /api/gcp/sync (real GCP data).
      2. Bundled parquet demo — only when ``DATA_ALLOW_PARQUET_FALLBACK=true``.
      3. Empty DataFrame — signals the frontend that no data has been synced yet.
    """
    events_df = _read_events_df()
    if len(events_df) > 0:
        _last_source["daily_costs"] = "events"
        return _daily_from_events(events_df)

    if get_settings().data_allow_parquet_fallback:
        path = _PARQUET_FILES["daily_costs"]
        if path.exists():
            df = pd.read_parquet(path)
            df["ds"] = pd.to_datetime(df["ds"])
            _mtimes["daily_costs"] = path.stat().st_mtime
            _last_source["daily_costs"] = "parquet_fallback"
            return df.sort_values("ds").reset_index(drop=True)

    _last_source["daily_costs"] = "empty"
    return pd.DataFrame(columns=["ds", "y"])


@lru_cache(maxsize=1)
def load_daily_per_service() -> pd.DataFrame:
    """Daily costs broken down by service (ds, Service1, Service2, ...).

    Same resolution order as ``load_daily_costs``.
    """
    events_df = _read_events_df()
    if len(events_df) > 0:
        _last_source["daily_per_service"] = "events"
        return _per_service_from_events(events_df)

    if get_settings().data_allow_parquet_fallback:
        path = _PARQUET_FILES["daily_per_service"]
        if path.exists():
            df = pd.read_parquet(path)
            df["ds"] = pd.to_datetime(df["ds"])
            _mtimes["daily_per_service"] = path.stat().st_mtime
            _last_source["daily_per_service"] = "parquet_fallback"
            return df.sort_values("ds").reset_index(drop=True)

    _last_source["daily_per_service"] = "empty"
    return pd.DataFrame(columns=["ds"])


def invalidate_cache() -> None:
    """Clear LRU caches for both loaders."""
    load_daily_costs.cache_clear()
    load_daily_per_service.cache_clear()
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

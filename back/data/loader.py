from __future__ import annotations

import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd

_DATA_DIR = Path(__file__).parent

_PARQUET_FILES = {
    "daily_costs": _DATA_DIR / "daily_costs.parquet",
    "daily_per_service": _DATA_DIR / "daily_per_service.parquet",
}

_mtimes: dict[str, float] = {}


@lru_cache(maxsize=1)
def load_daily_costs() -> pd.DataFrame:
    """Daily aggregated costs (ds, y)."""
    path = _PARQUET_FILES["daily_costs"]
    df = pd.read_parquet(path)
    df["ds"] = pd.to_datetime(df["ds"])
    _mtimes["daily_costs"] = path.stat().st_mtime
    return df.sort_values("ds").reset_index(drop=True)


@lru_cache(maxsize=1)
def load_daily_per_service() -> pd.DataFrame:
    """Daily costs broken down by service (ds, Service1, Service2, ...)."""
    path = _PARQUET_FILES["daily_per_service"]
    df = pd.read_parquet(path)
    df["ds"] = pd.to_datetime(df["ds"])
    _mtimes["daily_per_service"] = path.stat().st_mtime
    return df.sort_values("ds").reset_index(drop=True)


def invalidate_cache() -> None:
    """Clear LRU caches for both loaders."""
    load_daily_costs.cache_clear()
    load_daily_per_service.cache_clear()
    _mtimes.clear()


def get_data_fingerprint() -> dict[str, Any]:
    """Return current mtime for each parquet file — used by health endpoint."""
    return {
        name: {
            "mtime": path.stat().st_mtime if path.exists() else None,
            "size_bytes": path.stat().st_size if path.exists() else None,
        }
        for name, path in _PARQUET_FILES.items()
    }


def reload_if_changed() -> bool:
    """Check parquet mtimes; if changed, clear LRU + app_cache and return True."""
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

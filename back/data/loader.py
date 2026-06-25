from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

_DATA_DIR = Path(__file__).parent


@lru_cache(maxsize=1)
def load_daily_costs() -> pd.DataFrame:
    """Daily aggregated costs (ds, y)."""
    path = _DATA_DIR / "daily_costs.parquet"
    df = pd.read_parquet(path)
    df["ds"] = pd.to_datetime(df["ds"])
    return df.sort_values("ds").reset_index(drop=True)


@lru_cache(maxsize=1)
def load_daily_per_service() -> pd.DataFrame:
    """Daily costs broken down by service (ds, Service1, Service2, ...)."""
    path = _DATA_DIR / "daily_per_service.parquet"
    df = pd.read_parquet(path)
    df["ds"] = pd.to_datetime(df["ds"])
    return df.sort_values("ds").reset_index(drop=True)


def invalidate_cache() -> None:
    load_daily_costs.cache_clear()
    load_daily_per_service.cache_clear()

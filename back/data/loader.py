from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from core.config import get_settings
from core.user_context import current_user_scope

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

# PERF-001 / SEC-020: single-flight cache keyed by (user_scope, dataset).
# Before SEC-020, the cache was a flat dataset→DataFrame map — the first user
# to load parquet warmed it, and every subsequent request (even from a
# different user with fresh events) reused that stale frame. Now every user
# has their own slot; the parquet-fallback slot lives under the anonymous
# scope so the demo path still hits its cache. Per-key lock avoids concurrent
# parse floods (functools.lru_cache does not serialise the wrapped call body).
_load_cache: dict[tuple[str, str], pd.DataFrame] = {}
_cache_lock = threading.Lock()
_load_locks: dict[tuple[str, str], threading.Lock] = {}


def _scoped_key(dataset: str) -> tuple[str, str]:
    return current_user_scope(), dataset


def _lock_for(key: tuple[str, str]) -> threading.Lock:
    """Return (creating if needed) the lock for a given (scope, dataset) key.
    Creation itself is serialised under _cache_lock so two threads can't race
    on the ``setdefault`` and each publish their own lock instance."""
    with _cache_lock:
        return _load_locks.setdefault(key, threading.Lock())


def _single_flight(dataset: str, build: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    """Return the cached DataFrame for the current-user (scope, dataset) key,
    building it under a per-key lock if it's not cached yet (double-checked)."""
    key = _scoped_key(dataset)
    cached = _load_cache.get(key)
    if cached is not None:
        return cached
    with _lock_for(key):
        cached = _load_cache.get(key)
        if cached is not None:
            return cached
        built = build()
        _load_cache[key] = built
        return built

# Track which data source the most recent load resolved to so the /api/data/status
# endpoint (and callers who need to display provenance) can report it. Cleared
# by invalidate_cache() alongside the LRU caches. SEC-020: keyed by user scope.
_last_source: dict[tuple[str, str], str] = {}


def _set_last_source(dataset: str, value: str) -> None:
    _last_source[_scoped_key(dataset)] = value


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Median gap (in days) above which an ingested series is treated as a monthly
# export (e.g. a "Mois" column) rather than a daily one with holes.
_MONTHLY_GAP_DAYS = 21


def _regularize_daily(df: pd.DataFrame, value_cols: list[str]) -> pd.DataFrame:
    """Return ``df`` on a dense, regular daily calendar.

    Every downstream consumer (STL with period=7, Holt-Winters/Seasonal Naive,
    ACF lags, z-scores) treats row i-7 as "same weekday one week earlier" —
    which is false as soon as a day is missing from the groupby output, and
    silently desynchronizes the whole weekly seasonality. Two cases:

    - daily-ish input: reindex on the full calendar; a missing billing day
      means zero cost, so gaps are filled with 0.0;
    - monthly export (median step >= _MONTHLY_GAP_DAYS, e.g. a "Mois" column
      parsed to first-of-month dates): each monthly total is spread evenly
      across the days of its calendar month — otherwise STL(period=7) computes
      a meaningless pseudo-weekly pattern on ~12 isolated spikes. The month
      containing today is only spread up to today (a partial total spread over
      future days would understate the daily rate and push fake "actuals"
      beyond the forecast start), and the spread output goes through the same
      dense reindex so a month missing from the export becomes zeros instead
      of a calendar hole.

    Known limitation: intermediate cadences (weekly/bi-monthly exports) take
    the daily branch and end up mostly zero-filled — a warning-worthy input
    the platform does not resample yet.
    """
    if len(df) < 2:
        return df

    deltas = df["ds"].diff().dt.days.dropna()
    if not len(deltas):
        return df
    median_step = float(deltas.median())

    if median_step >= _MONTHLY_GAP_DAYS:
        today = pd.Timestamp.today().normalize()
        rows: list[dict] = []
        # dict records, not itertuples: service column names contain spaces
        # ("Cloud SQL") which itertuples mangles into positional attributes.
        for row in df.to_dict("records"):
            start = pd.Timestamp(row["ds"]).normalize().replace(day=1)
            end = start + pd.offsets.MonthEnd(0)
            if start <= today < end:
                # Current month: its exported total only covers spend to date.
                end = today
            days = pd.date_range(start, end, freq="D")
            for d in days:
                new: dict = {"ds": d}
                for c in value_cols:
                    new[c] = float(row.get(c) or 0.0) / len(days)
                rows.append(new)
        out = pd.DataFrame(rows).groupby("ds", as_index=False)[value_cols].sum()
        from core.logging import get_logger

        get_logger(__name__).info(
            "monthly_series_spread_to_daily",
            extra={"input_rows": len(df), "output_rows": len(out)},
        )
        # Fall through to the dense reindex: a month absent from the export
        # must become zeros, not a hole that desyncs the weekly seasonality.
        df = out.sort_values("ds").reset_index(drop=True)

    full = pd.date_range(df["ds"].min(), df["ds"].max(), freq="D")
    if len(full) == len(df):
        return df
    out = df.set_index("ds").reindex(full, fill_value=0.0).rename_axis("ds").reset_index()
    from core.logging import get_logger

    get_logger(__name__).info(
        "daily_series_gaps_filled",
        extra={"missing_days": int(len(full) - len(df)), "total_days": int(len(full))},
    )
    return out


def _daily_from_events(events_df: pd.DataFrame) -> pd.DataFrame:
    """Sum injected events per day → the (ds, y) schema used everywhere else."""
    if len(events_df) == 0:
        return pd.DataFrame(columns=["ds", "y"])
    df = events_df.groupby("ds", as_index=False)["Sous-total (€)"].sum()
    df = df.rename(columns={"Sous-total (€)": "y"})
    df["ds"] = pd.to_datetime(df["ds"])
    df = df.sort_values("ds").reset_index(drop=True)
    return _regularize_daily(df, ["y"])


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
    df = df.sort_values("ds").reset_index(drop=True)
    return _regularize_daily(df, [c for c in df.columns if c != "ds"])


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
    """Daily aggregated costs (ds, y) for the current user.

    Resolution order:
      1. Live data ingested via /api/events or /api/gcp/sync (real GCP data).
      2. Bundled parquet demo — only when ``DATA_ALLOW_PARQUET_FALLBACK=true``.
      3. Empty DataFrame — signals the frontend that no data has been synced yet.
    """

    def _build() -> pd.DataFrame:
        events_df = _read_events_df()
        if len(events_df) > 0:
            _set_last_source("daily_costs", "events")
            return _daily_from_events(events_df)

        if get_settings().data_allow_parquet_fallback:
            path = _PARQUET_FILES["daily_costs"]
            if path.exists():
                df = _safe_read_parquet(path)
                if df is not None:
                    df["ds"] = pd.to_datetime(df["ds"])
                    _mtimes["daily_costs"] = path.stat().st_mtime
                    _set_last_source("daily_costs", "parquet_fallback")
                    return df.sort_values("ds").reset_index(drop=True)

        _set_last_source("daily_costs", "empty")
        return pd.DataFrame(columns=["ds", "y"])

    return _single_flight("daily_costs", _build)


def load_daily_per_service() -> pd.DataFrame:
    """Daily costs broken down by service (ds, Service1, Service2, ...).

    Same resolution order as ``load_daily_costs``.
    """

    def _build() -> pd.DataFrame:
        events_df = _read_events_df()
        if len(events_df) > 0:
            _set_last_source("daily_per_service", "events")
            return _per_service_from_events(events_df)

        if get_settings().data_allow_parquet_fallback:
            path = _PARQUET_FILES["daily_per_service"]
            if path.exists():
                df = _safe_read_parquet(path)
                if df is not None:
                    df["ds"] = pd.to_datetime(df["ds"])
                    _mtimes["daily_per_service"] = path.stat().st_mtime
                    _set_last_source("daily_per_service", "parquet_fallback")
                    return df.sort_values("ds").reset_index(drop=True)

        _set_last_source("daily_per_service", "empty")
        return pd.DataFrame(columns=["ds"])

    return _single_flight("daily_per_service", _build)


def invalidate_cache() -> None:
    """Clear the single-flight cache across every user and reset provenance.

    Called from ingest endpoints so newly-uploaded data replaces the stale
    frame at the next read. Global by design — an event ingest for user A
    only needs to invalidate A's slot, but the mtime map is shared, so we
    clear all slots and let each user rebuild on demand.
    """
    with _cache_lock:
        _load_cache.clear()
        _mtimes.clear()
        _last_source.clear()


def get_last_source() -> dict[str, str]:
    """Return the source of the most recent successful load per dataset,
    scoped to the current user."""
    scope = current_user_scope()
    return {
        dataset: value
        for (user, dataset), value in _last_source.items()
        if user == scope
    }


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

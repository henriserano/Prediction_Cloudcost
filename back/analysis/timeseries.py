from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from core.cache import app_cache
from core.errors import NotEnoughData
from data.loader import load_daily_costs
from schemas.analytics import (
    ACFPoint,
    AnomalyPoint,
    DailyPoint,
    DescriptiveStats,
    StationarityResult,
    StationarityTest,
    STLPoint,
    STLStrengths,
)

# ---------------------------------------------------------------------------
# Daily series helpers
# ---------------------------------------------------------------------------

# Minimum points for the statistical routines: STL with period=7 requires at
# least 2 full cycles (14); ADF/KPSS need a comparable minimum to be defined.
_MIN_POINTS_SEASONAL = 14


def _series() -> pd.Series:
    df = load_daily_costs()
    return df.set_index("ds")["y"]


def _require_min_points(n_points: int, minimum: int, what: str) -> None:
    """Raise a clean 422 instead of letting scipy/statsmodels traceback (SEC-017)."""
    if n_points < minimum:
        raise NotEnoughData(
            f"Not enough data for {what}: {n_points} daily point(s) available, "
            f"at least {minimum} required. Ingest data via /api/events or "
            f"/api/gcp/sync first.",
            details={"points": int(n_points), "min_required": minimum},
        )


def _rolling_mean(s: pd.Series, window: int = 7) -> pd.Series:
    return s.rolling(window, min_periods=1).mean()


def _trend_ci(s: pd.Series, z: float = 1.96) -> tuple[pd.Series, pd.Series]:
    residuals = s - _rolling_mean(s)
    std_r = residuals.expanding(min_periods=1).std().fillna(0)
    ma = _rolling_mean(s)
    return ma - z * std_r, ma + z * std_r


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_daily_series(last_n: int | None = None) -> list[DailyPoint]:
    _cache_key = "analytics:daily" if last_n is None else f"analytics:daily:{last_n}"
    _cached = app_cache.get(_cache_key)
    if _cached is not None:
        return _cached

    s = _series()
    if last_n:
        s = s.iloc[-last_n:]

    ma = _rolling_mean(s)
    ci_low, ci_high = _trend_ci(s)

    result = [
        DailyPoint(
            date=idx.strftime("%Y-%m-%d"),
            cost=round(float(val), 4),
            ma7=round(float(ma[idx]), 4),
            ci_low=round(float(max(0, ci_low[idx])), 4),
            ci_high=round(float(ci_high[idx]), 4),
        )
        for idx, val in s.items()
    ]
    app_cache.set(_cache_key, result)
    return result


def get_descriptive_stats() -> DescriptiveStats:
    cached = app_cache.get("analytics:stats")
    if cached is not None:
        return cached
    s = _series()
    arr = s.values.astype(float)
    _require_min_points(len(arr), 2, "descriptive statistics")
    q1, q3 = np.percentile(arr, [25, 75])
    result = DescriptiveStats(
        mean=round(float(np.mean(arr)), 4),
        median=round(float(np.median(arr)), 4),
        std=round(float(np.std(arr, ddof=1)), 4),
        cv=round(float(np.std(arr, ddof=1) / np.mean(arr) * 100), 4),
        skewness=round(float(stats.skew(arr)), 4),
        kurtosis=round(float(stats.kurtosis(arr, fisher=False)), 4),
        iqr=round(float(q3 - q1), 4),
        mad=round(float(np.median(np.abs(arr - np.median(arr)))), 4),
        min=round(float(np.min(arr)), 4),
        max=round(float(np.max(arr)), 4),
    )
    app_cache.set("analytics:stats", result)
    return result


def get_stationarity() -> StationarityResult:
    cached = app_cache.get("analytics:stationarity")
    if cached is not None:
        return cached
    from statsmodels.tsa.stattools import adfuller, kpss

    s = _series()
    arr = s.values.astype(float)
    _require_min_points(len(arr), _MIN_POINTS_SEASONAL, "ADF/KPSS stationarity tests")

    # ADF  (H0: unit root  →  p < 0.05 ⟹ stationary)
    adf_res = adfuller(arr, autolag="AIC")
    adf = StationarityTest(
        statistic=round(float(adf_res[0]), 6),
        p_value=round(float(adf_res[1]), 6),
        is_stationary=bool(adf_res[1] < 0.05),
        lags_used=int(adf_res[2]),
    )

    # KPSS (H0: stationary  →  p < 0.05 ⟹ non-stationary)
    kpss_res = kpss(arr, regression="c", nlags="auto")
    kpss_stat = StationarityTest(
        statistic=round(float(kpss_res[0]), 6),
        p_value=round(float(kpss_res[1]), 6),
        is_stationary=bool(kpss_res[1] >= 0.05),
        lags_used=int(kpss_res[2]),
    )

    result = StationarityResult(adf=adf, kpss=kpss_stat)
    app_cache.set("analytics:stationarity", result)
    return result


def get_stl_decomposition() -> tuple[list[STLPoint], STLStrengths]:
    cached = app_cache.get("analytics:stl")
    if cached is not None:
        return cached
    from statsmodels.tsa.seasonal import STL

    s = _series()
    _require_min_points(len(s), _MIN_POINTS_SEASONAL, "STL decomposition (period=7)")
    stl = STL(s, period=7, robust=True)
    stl_fit = stl.fit()

    trend = stl_fit.trend
    seasonal = stl_fit.seasonal
    residual = stl_fit.resid

    # Force of trend / seasonality (Wang 2006)
    var_r = float(np.var(residual.values, ddof=1))
    ft = max(0.0, 1 - var_r / float(np.var((trend + residual).values, ddof=1)))
    fs = max(0.0, 1 - var_r / float(np.var((seasonal + residual).values, ddof=1)))

    points = [
        STLPoint(
            date=idx.strftime("%Y-%m-%d"),
            trend=round(float(trend[idx]), 4),
            seasonal=round(float(seasonal[idx]), 4),
            residual=round(float(residual[idx]), 4),
        )
        for idx in s.index
    ]
    strengths = STLStrengths(ft=round(ft, 4), fs=round(fs, 4), period=7)
    result = (points, strengths)
    app_cache.set("analytics:stl", result)
    return result


def get_anomalies(z_threshold: float = 2.0) -> list[AnomalyPoint]:
    # SEC: quantize the float in the cache key so ?z_threshold=2.0000001 and
    # 2.0000002 collide instead of each spawning a new entry.
    _cache_key = f"analytics:anomalies:{round(z_threshold, 2):.2f}"
    cached = app_cache.get(_cache_key)
    if cached is not None:
        return cached
    s = _series()
    arr = s.values.astype(float)
    _require_min_points(len(arr), 2, "anomaly detection")
    mean_, std_ = float(np.mean(arr)), float(np.std(arr, ddof=1))

    # Guard against a degenerate std (identical values across the series, which
    # happens right after a simulation push that emits N identical monthly
    # events for the same service). Without this the z-score computation
    # crashes the /api/anomalies endpoint with a ZeroDivisionError. When
    # everything is equal, nothing is anomalous by definition — return all
    # z-scores at 0 and is_anomaly = False.
    if std_ <= 0 or not math.isfinite(std_):
        result = [
            AnomalyPoint(
                date=idx.strftime("%Y-%m-%d"),
                cost=round(float(val), 4),
                zscore=0.0,
                is_anomaly=False,
            )
            for idx, val in s.items()
        ]
        app_cache.set(_cache_key, result)
        return result

    result = [
        AnomalyPoint(
            date=idx.strftime("%Y-%m-%d"),
            cost=round(float(val), 4),
            zscore=round((float(val) - mean_) / std_, 4),
            is_anomaly=bool(abs((float(val) - mean_) / std_) > z_threshold),
        )
        for idx, val in s.items()
    ]
    app_cache.set(_cache_key, result)
    return result


def get_acf_pacf(nlags: int = 28) -> list[ACFPoint]:
    _cache_key = f"analytics:acf:{nlags}"
    cached = app_cache.get(_cache_key)
    if cached is not None:
        return cached
    from statsmodels.tsa.stattools import acf, pacf

    s = _series()
    arr = s.values.astype(float)
    _require_min_points(len(arr), nlags + 1, f"ACF/PACF with nlags={nlags}")
    acf_vals = acf(arr, nlags=nlags, fft=True)
    pacf_vals = pacf(arr, nlags=nlags)

    result = [
        ACFPoint(lag=i, acf=round(float(acf_vals[i]), 6), pacf=round(float(pacf_vals[i]), 6))
        for i in range(1, nlags + 1)
    ]
    app_cache.set(_cache_key, result)
    return result

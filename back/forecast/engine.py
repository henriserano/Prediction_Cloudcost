from __future__ import annotations

import math
from typing import List, Tuple

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

from data.loader import load_daily_costs
from schemas.forecast import ForecastPoint, ForecastSummary, ModelBenchmark
from core.cache import app_cache
from core.errors import NotEnoughData


# ---------------------------------------------------------------------------
# Metric helpers
# ---------------------------------------------------------------------------

def _mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    mask = y_true != 0
    if not mask.any():
        return float("nan")
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100)


def _r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    ss_res = np.sum((y_true - y_pred) ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    return float(1 - ss_res / ss_tot) if ss_tot else 0.0


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(math.sqrt(mean_squared_error(y_true, y_pred)))


# ---------------------------------------------------------------------------
# Individual model implementations
# ---------------------------------------------------------------------------

def _ets_forecast(train: np.ndarray, h: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """ExponentialSmoothing with Holt's additive trend (ETS)."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    model = ExponentialSmoothing(
        train,
        trend="add",
        seasonal=None,
        initialization_method="estimated",
    )
    fit = model.fit(optimized=True, remove_bias=True)
    forecast = fit.forecast(h)

    # Prediction intervals from residual std
    resid_std = float(np.std(fit.resid, ddof=1))
    z80, z95 = 1.282, 1.96
    low80 = forecast - z80 * resid_std * np.sqrt(np.arange(1, h + 1))
    high80 = forecast + z80 * resid_std * np.sqrt(np.arange(1, h + 1))
    low95 = forecast - z95 * resid_std * np.sqrt(np.arange(1, h + 1))
    high95 = forecast + z95 * resid_std * np.sqrt(np.arange(1, h + 1))

    ci80 = np.stack([np.maximum(0, low80), high80], axis=1)
    ci95 = np.stack([np.maximum(0, low95), high95], axis=1)
    return forecast, ci80, ci95


def _theta_forecast(train: np.ndarray, h: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Theta method: decompose into SES (theta=0) + linear trend (theta=2)."""
    n = len(train)
    x = np.arange(n, dtype=float)

    # Linear trend via OLS
    slope, intercept = np.polyfit(x, train, 1)
    trend_line = slope * x + intercept
    detrended = train - trend_line

    # SES on detrended
    alpha = 0.5  # standard Theta
    ses = np.zeros(n)
    ses[0] = detrended[0]
    for i in range(1, n):
        ses[i] = alpha * detrended[i] + (1 - alpha) * ses[i - 1]

    # Forecast
    h_range = np.arange(n, n + h, dtype=float)
    trend_fc = slope * h_range + intercept
    ses_fc = np.full(h, ses[-1])
    forecast = 0.5 * (trend_fc + ses_fc)

    resid = detrended - ses
    std_r = float(np.std(resid, ddof=1))
    z80, z95 = 1.282, 1.96
    ci80 = np.stack([
        np.maximum(0, forecast - z80 * std_r),
        forecast + z80 * std_r,
    ], axis=1)
    ci95 = np.stack([
        np.maximum(0, forecast - z95 * std_r),
        forecast + z95 * std_r,
    ], axis=1)
    return forecast, ci80, ci95


def _arima_forecast(train: np.ndarray, h: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    from statsmodels.tsa.arima.model import ARIMA

    model = ARIMA(train, order=(1, 1, 1))
    fit = model.fit()
    pred = fit.get_forecast(steps=h)
    forecast = pred.predicted_mean
    ci = pred.conf_int(alpha=0.05)  # 95% CI
    ci95 = np.stack([np.maximum(0, ci[:, 0]), ci[:, 1]], axis=1)
    ci_80 = pred.conf_int(alpha=0.20)
    ci80 = np.stack([np.maximum(0, ci_80[:, 0]), ci_80[:, 1]], axis=1)
    return forecast, ci80, ci95


def _ses_forecast(train: np.ndarray, h: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Simple Exponential Smoothing (fast + naive baseline)."""
    from statsmodels.tsa.holtwinters import SimpleExpSmoothing

    fit = SimpleExpSmoothing(train, initialization_method="estimated").fit(optimized=True)
    forecast = fit.forecast(h)
    std_r = float(np.std(fit.resid, ddof=1))
    z80, z95 = 1.282, 1.96
    ci80 = np.stack([np.maximum(0, forecast - z80 * std_r), forecast + z80 * std_r], axis=1)
    ci95 = np.stack([np.maximum(0, forecast - z95 * std_r), forecast + z95 * std_r], axis=1)
    return forecast, ci80, ci95


def _holt_winters_forecast(train: np.ndarray, h: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Holt-Winters additive seasonal (period=7)."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    model = ExponentialSmoothing(
        train,
        trend="add",
        seasonal="add",
        seasonal_periods=7,
        initialization_method="estimated",
    )
    fit = model.fit(optimized=True)
    forecast = fit.forecast(h)
    std_r = float(np.std(fit.resid, ddof=1))
    z80, z95 = 1.282, 1.96
    ci80 = np.stack([np.maximum(0, forecast - z80 * std_r), forecast + z80 * std_r], axis=1)
    ci95 = np.stack([np.maximum(0, forecast - z95 * std_r), forecast + z95 * std_r], axis=1)
    return forecast, ci80, ci95


def _naive_seasonal_forecast(train: np.ndarray, h: int, period: int = 7) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Seasonal Naive (last observed season repeated)."""
    last_season = train[-period:]
    tiles = math.ceil(h / period)
    forecast = np.tile(last_season, tiles)[:h].astype(float)
    std_r = float(np.std(train[-period * 4:], ddof=1))
    z80, z95 = 1.282, 1.96
    ci80 = np.stack([np.maximum(0, forecast - z80 * std_r), forecast + z80 * std_r], axis=1)
    ci95 = np.stack([np.maximum(0, forecast - z95 * std_r), forecast + z95 * std_r], axis=1)
    return forecast, ci80, ci95


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

# Honest model names: each entry is named after the statsmodels/numpy
# implementation actually used, not after the deep-learning model it once
# proxied ("Prophet", "N-HiTS", "TimesNet" were misleading).
MODELS = {
    "ETS": ("Exp. Smoothing", _ets_forecast),
    "Theta": ("Theta", _theta_forecast),
    "ARIMA(1,1,1)": ("ARIMA", _arima_forecast),
    "SES": ("Exp. Smoothing", _ses_forecast),
    "Holt-Winters": ("Holt-Winters", _holt_winters_forecast),
    "Seasonal Naive": ("Seasonal Naive", _naive_seasonal_forecast),
}

# Legacy ids still accepted in the ?model= query param so existing frontend
# references (e.g. the hardcoded "AutoETS" default) keep working.
MODEL_ALIASES = {
    "AutoETS": "ETS",
    "AutoTheta": "Theta",
    "AutoARIMA": "ARIMA(1,1,1)",
    "Prophet (SES)": "SES",
    "N-HiTS (HW)": "Holt-Winters",
    "TimesNet (SNaive)": "Seasonal Naive",
}


def resolve_model(name: str) -> str | None:
    """Map a requested model name (current or legacy alias) to a MODELS key."""
    if name in MODELS:
        return name
    return MODEL_ALIASES.get(name)


# Minimum series length any model can be fitted on (Holt-Winters needs two
# full weekly seasons; ARIMA/ETS need a comparable minimum to converge).
_MIN_SERIES_POINTS = 14


def _finite_or_none(x: float | None) -> float | None:
    """Replace inf/NaN with None so responses stay valid JSON."""
    if x is None:
        return None
    return x if math.isfinite(x) else None


# ---------------------------------------------------------------------------
# Walk-forward CV for benchmark
# ---------------------------------------------------------------------------

def _walk_forward_cv(arr: np.ndarray, fn, n_splits: int = 5, h: int = 14) -> dict:
    n = len(arr)
    min_train = max(30, n - n_splits * h)

    all_y_true, all_y_pred = [], []
    for i in range(n_splits):
        split = min_train + i * h
        if split + h > n:
            break
        train = arr[:split]
        test = arr[split: split + h]
        try:
            pred, _, _ = fn(train, h)
            all_y_true.append(test)
            all_y_pred.append(pred[:len(test)])
        except Exception:
            continue

    if not all_y_true:
        return {"mae": float("inf"), "rmse": float("inf"), "mape": float("inf"), "r2": -float("inf")}

    y_true = np.concatenate(all_y_true)
    y_pred = np.concatenate(all_y_pred)
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": _rmse(y_true, y_pred),
        "mape": _mape(y_true, y_pred),
        "r2": _r2(y_true, y_pred),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_model_benchmarks() -> List[ModelBenchmark]:
    cached = app_cache.get("forecast:benchmarks")
    if cached is not None:
        return cached

    df = load_daily_costs()
    arr = df["y"].values.astype(float)

    scores: list[dict] = []
    for name, (family, fn) in MODELS.items():
        metrics = _walk_forward_cv(arr, fn)
        scores.append({"model": name, "family": family, **metrics})

    # Rank by MAE ascending (inf sorts last)
    scores.sort(key=lambda x: x["mae"])
    best_mae = scores[0]["mae"]
    result = []
    for rank, row in enumerate(scores, 1):
        if math.isfinite(best_mae) and best_mae > 0 and math.isfinite(row["mae"]):
            score = round(row["mae"] / best_mae, 4)
        else:
            score = None
        # Sanitize inf/NaN → None so the JSON response stays valid even when a
        # model failed every CV fold (mae=inf) or produced degenerate metrics.
        mae = _finite_or_none(row["mae"])
        rmse = _finite_or_none(row["rmse"])
        mape = _finite_or_none(row["mape"])
        r2 = _finite_or_none(row["r2"])
        result.append(
            ModelBenchmark(
                rank=rank,
                model=row["model"],
                family=row["family"],
                mae=round(mae, 4) if mae is not None else None,
                rmse=round(rmse, 4) if rmse is not None else None,
                mape=round(mape, 2) if mape is not None else None,
                r2=round(r2, 4) if r2 is not None else None,
                score=score,
                winner=(rank == 1),
            )
        )
    app_cache.set("forecast:benchmarks", result)
    return result


def get_forecast(horizon: int = 60, model: str = "ETS") -> tuple[List[ForecastPoint], ForecastSummary]:
    resolved = resolve_model(model)
    if resolved is None:
        raise ValueError(f"Unknown model '{model}'. Available: {list(MODELS.keys())}")
    model = resolved

    _cache_key = f"forecast:{model}:{horizon}"
    _cached = app_cache.get(_cache_key)
    if _cached is not None:
        return _cached

    df = load_daily_costs()
    # SEC-017: guard against empty/short series — df["ds"].iloc[-1] would
    # otherwise raise an IndexError that surfaces as an opaque 500.
    if len(df) < _MIN_SERIES_POINTS:
        raise NotEnoughData(
            f"Not enough data to forecast: {len(df)} daily point(s) available, "
            f"at least {_MIN_SERIES_POINTS} required. Ingest data via /api/events "
            f"or /api/gcp/sync first.",
            details={"points": int(len(df)), "min_required": _MIN_SERIES_POINTS},
        )
    arr = df["y"].values.astype(float)
    last_date = df["ds"].iloc[-1]

    _family, fn = MODELS[model]
    forecast_vals, ci80, ci95 = fn(arr, horizon)

    # Last 30 actuals included for context in chart
    n_hist = 30
    hist = df.iloc[-n_hist:]

    points: List[ForecastPoint] = []

    for i, row in enumerate(hist.itertuples()):
        points.append(
            ForecastPoint(
                date=row.ds.strftime("%Y-%m-%d"),
                forecast=round(float(row.y), 4),
                low80=round(float(row.y), 4),
                high80=round(float(row.y), 4),
                low95=round(float(row.y), 4),
                high95=round(float(row.y), 4),
                actual=round(float(row.y), 4),
            )
        )

    future_dates = pd.date_range(last_date + pd.Timedelta(days=1), periods=horizon, freq="D")
    for i, dt in enumerate(future_dates):
        points.append(
            ForecastPoint(
                date=dt.strftime("%Y-%m-%d"),
                forecast=round(float(max(0, forecast_vals[i])), 4),
                low80=round(float(ci80[i, 0]), 4),
                high80=round(float(ci80[i, 1]), 4),
                low95=round(float(ci95[i, 0]), 4),
                high95=round(float(ci95[i, 1]), 4),
                actual=None,
            )
        )

    total_fc = round(float(np.sum(np.maximum(0, forecast_vals[:30]))), 2)

    # Best model MAE from cached benchmark (lazy re-compute to avoid double CV)
    bench = get_model_benchmarks()
    winner = next((b for b in bench if b.winner), bench[0])

    summary = ForecastSummary(
        horizon_days=horizon,
        total_forecast=total_fc,
        daily_avg_forecast=round(total_fc / 30, 4),
        best_model=winner.model,
        best_model_mae=winner.mae,
        best_model_mape=winner.mape,
        models_evaluated=len(MODELS),
    )
    app_cache.set(f"forecast:{model}:{horizon}", (points, summary))
    return points, summary

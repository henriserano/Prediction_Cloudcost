from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

from core.cache import app_cache, scoped_key
from core.errors import NotEnoughData
from core.logging import get_logger
from data.loader import load_daily_costs
from schemas.forecast import ForecastPoint, ForecastSummary, ModelBenchmark

logger = get_logger(__name__)

# Daily billing series carry a weekly cycle (weekday/weekend usage) — this is
# a domain assumption of the platform, not a tunable: every seasonal model and
# STL consumer uses the same period.
SEASONAL_PERIOD = 7

_Z80, _Z95 = 1.282, 1.96

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


def _ci_from_std(forecast: np.ndarray, std_r: float) -> tuple[np.ndarray, np.ndarray]:
    """Fallback prediction bands from a residual std, widened with sqrt(lead).

    Only used when the series is too short for the empirical out-of-sample
    bands computed in ``get_forecast`` (see ``_cv_sigma_by_lead``). The
    sqrt(lead) growth is a random-walk-style default — crude, but strictly
    better than the constant-width bands it replaces (uncertainty at D+90
    displayed equal to D+1 violates the most basic property of a prediction
    interval).
    """
    h = len(forecast)
    steps = np.sqrt(np.arange(1, h + 1, dtype=float))
    ci80 = np.stack(
        [np.maximum(0, forecast - _Z80 * std_r * steps), forecast + _Z80 * std_r * steps],
        axis=1,
    )
    ci95 = np.stack(
        [np.maximum(0, forecast - _Z95 * std_r * steps), forecast + _Z95 * std_r * steps],
        axis=1,
    )
    return ci80, ci95


# ---------------------------------------------------------------------------
# Individual model implementations
# ---------------------------------------------------------------------------


def _ets_forecast(train: np.ndarray, h: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """ExponentialSmoothing with Holt's additive trend (ETS)."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    model = ExponentialSmoothing(
        train,
        trend="add",
        seasonal=None,
        initialization_method="estimated",
    )
    fit = model.fit(optimized=True, remove_bias=True)
    forecast = np.asarray(fit.forecast(h), dtype=float)

    resid_std = float(np.std(fit.resid, ddof=1))
    ci80, ci95 = _ci_from_std(forecast, resid_std)
    return forecast, ci80, ci95


def _theta_forecast(train: np.ndarray, h: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Theta method: decompose into SES (theta=0) + linear trend (theta=2)."""
    n = len(train)
    x = np.arange(n, dtype=float)

    # Linear trend via OLS
    slope, intercept = np.polyfit(x, train, 1)
    trend_line = slope * x + intercept
    detrended = train - trend_line

    # SES on the detrended component — smoothing weight estimated by MLE
    # instead of a hardcoded alpha, which is only kept as a failure fallback.
    try:
        from statsmodels.tsa.holtwinters import SimpleExpSmoothing

        ses_fit = SimpleExpSmoothing(detrended, initialization_method="estimated").fit(
            optimized=True
        )
        fitted = np.asarray(ses_fit.fittedvalues, dtype=float)
        level = float(np.asarray(ses_fit.forecast(1), dtype=float)[0])
    except Exception:
        alpha = 0.5
        fitted = np.zeros(n)
        fitted[0] = detrended[0]
        for i in range(1, n):
            fitted[i] = alpha * detrended[i] + (1 - alpha) * fitted[i - 1]
        level = float(fitted[-1])

    # Forecast
    h_range = np.arange(n, n + h, dtype=float)
    trend_fc = slope * h_range + intercept
    ses_fc = np.full(h, level)
    forecast = 0.5 * (trend_fc + ses_fc)

    resid = detrended - fitted
    std_r = float(np.std(resid, ddof=1))
    ci80, ci95 = _ci_from_std(forecast, std_r)
    return forecast, ci80, ci95


# Candidate (order, seasonal_order) pairs, selected by AIC on each fit. Small
# on purpose (3 fits max) so the walk-forward CV stays affordable, but no
# longer blind to the weekly cycle the way the hardcoded (1,1,1) was.
_ARIMA_CANDIDATES: list[tuple[tuple[int, int, int], tuple[int, int, int, int]]] = [
    ((1, 1, 1), (0, 0, 0, 0)),
    ((0, 1, 1), (0, 0, 0, 0)),
    ((1, 1, 1), (1, 0, 1, SEASONAL_PERIOD)),
]


def _arima_forecast(train: np.ndarray, h: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """ARIMA with light AIC-based order selection (incl. a weekly seasonal
    candidate). Keeps the analytic statsmodels prediction intervals — the only
    model of the registry whose bands widen correctly out of the box."""
    from statsmodels.tsa.arima.model import ARIMA

    best_fit = None
    best_aic = math.inf
    for order, seasonal_order in _ARIMA_CANDIDATES:
        # A seasonal candidate needs a few full cycles to be identifiable.
        if seasonal_order[3] and len(train) < 3 * seasonal_order[3]:
            continue
        try:
            fit = ARIMA(train, order=order, seasonal_order=seasonal_order).fit()
        except Exception:
            continue
        aic = float(fit.aic)
        if math.isfinite(aic) and aic < best_aic:
            best_fit, best_aic = fit, aic

    if best_fit is None:
        raise RuntimeError("ARIMA: no candidate order converged on this series")

    pred = best_fit.get_forecast(steps=h)
    forecast = np.asarray(pred.predicted_mean, dtype=float)
    ci = pred.conf_int(alpha=0.05)  # 95% CI
    ci95 = np.stack([np.maximum(0, ci[:, 0]), ci[:, 1]], axis=1)
    ci_80 = pred.conf_int(alpha=0.20)
    ci80 = np.stack([np.maximum(0, ci_80[:, 0]), ci_80[:, 1]], axis=1)
    return forecast, ci80, ci95


def _ses_forecast(train: np.ndarray, h: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Simple Exponential Smoothing (fast + naive baseline)."""
    from statsmodels.tsa.holtwinters import SimpleExpSmoothing

    fit = SimpleExpSmoothing(train, initialization_method="estimated").fit(optimized=True)
    forecast = np.asarray(fit.forecast(h), dtype=float)
    std_r = float(np.std(fit.resid, ddof=1))
    ci80, ci95 = _ci_from_std(forecast, std_r)
    return forecast, ci80, ci95


def _holt_winters_forecast(train: np.ndarray, h: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Holt-Winters additive seasonal (period=7)."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    model = ExponentialSmoothing(
        train,
        trend="add",
        seasonal="add",
        seasonal_periods=SEASONAL_PERIOD,
        initialization_method="estimated",
    )
    fit = model.fit(optimized=True)
    forecast = np.asarray(fit.forecast(h), dtype=float)
    std_r = float(np.std(fit.resid, ddof=1))
    ci80, ci95 = _ci_from_std(forecast, std_r)
    return forecast, ci80, ci95


def _naive_seasonal_forecast(
    train: np.ndarray, h: int, period: int = SEASONAL_PERIOD
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Seasonal Naive (last observed season repeated)."""
    last_season = train[-period:]
    tiles = math.ceil(h / period)
    forecast = np.tile(last_season, tiles)[:h].astype(float)
    std_r = float(np.std(train[-period * 4 :], ddof=1))
    ci80, ci95 = _ci_from_std(forecast, std_r)
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
    "ARIMA": ("ARIMA", _arima_forecast),
    "SES": ("Exp. Smoothing", _ses_forecast),
    "Holt-Winters": ("Holt-Winters", _holt_winters_forecast),
    "Seasonal Naive": ("Seasonal Naive", _naive_seasonal_forecast),
}

# Legacy ids still accepted in the ?model= query param so existing frontend
# references (e.g. the hardcoded "AutoETS" default) keep working.
MODEL_ALIASES = {
    "AutoETS": "ETS",
    "AutoTheta": "Theta",
    "AutoARIMA": "ARIMA",
    # Pre-AIC-selection name — the model is no longer pinned to (1,1,1).
    "ARIMA(1,1,1)": "ARIMA",
    "Prophet (SES)": "SES",
    "N-HiTS (HW)": "Holt-Winters",
    "TimesNet (SNaive)": "Seasonal Naive",
}


def resolve_model(name: str) -> str | None:
    """Map a requested model name (current or legacy alias) to a MODELS key."""
    if name in MODELS:
        return name
    return MODEL_ALIASES.get(name)


def cv_bucket(horizon: int) -> int:
    """CV-horizon bucket (7/14/28) matching a served forecast horizon.

    Shared by ``get_forecast`` and the /models route so the benchmark table
    the frontend displays is the same one ``summary.best_model`` was elected
    from — two different buckets would name two different champions side by
    side.
    """
    if horizon <= 7:
        return 7
    if horizon < 28:
        return 14
    return 28


# Minimum series length any model can be fitted on (Holt-Winters needs two
# full weekly seasons; ARIMA/ETS need a comparable minimum to converge).
_MIN_SERIES_POINTS = 14


def _finite_or_none(x: float | None) -> float | None:
    """Replace inf/NaN with None so responses stay valid JSON."""
    if x is None:
        return None
    return x if math.isfinite(x) else None


# ---------------------------------------------------------------------------
# Walk-forward CV — shared by the benchmark and the empirical intervals
# ---------------------------------------------------------------------------


def _cv_folds(
    arr: np.ndarray, fn, n_splits: int = 5, h: int = 14, model_name: str = ""
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Expanding-window walk-forward folds: fit on [:split], predict the next h.

    Returns the (y_true, y_pred) pair of each successful fold. A failing fit
    is logged (model + fold + train size) instead of being silently swallowed
    — a model that errors on every fold used to vanish from the diagnostics
    with no trace at all.
    """
    n = len(arr)
    min_train = max(30, n - n_splits * h)

    folds: list[tuple[np.ndarray, np.ndarray]] = []
    for i in range(n_splits):
        split = min_train + i * h
        if split + h > n:
            break
        train = arr[:split]
        test = arr[split : split + h]
        try:
            pred, _, _ = fn(train, h)
            folds.append((test, np.asarray(pred, dtype=float)[: len(test)]))
        except Exception as exc:
            logger.warning(
                "cv_fold_failed",
                extra={
                    "model": model_name,
                    "fold": i,
                    "train_size": int(split),
                    "error": repr(exc),
                },
            )
    return folds


def _walk_forward_cv(
    arr: np.ndarray, fn, n_splits: int = 5, h: int = 14, model_name: str = ""
) -> dict:
    folds = _cv_folds(arr, fn, n_splits=n_splits, h=h, model_name=model_name)
    if not folds:
        return {
            "mae": float("inf"),
            "rmse": float("inf"),
            "mape": float("inf"),
            "r2": -float("inf"),
        }

    y_true = np.concatenate([t for t, _ in folds])
    y_pred = np.concatenate([p for _, p in folds])
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": _rmse(y_true, y_pred),
        "mape": _mape(y_true, y_pred),
        "r2": _r2(y_true, y_pred),
    }


def _cv_sigma_by_lead(
    arr: np.ndarray,
    fn,
    horizon: int,
    n_splits: int = 5,
    h: int = 14,
    model_name: str = "",
) -> np.ndarray | None:
    """Out-of-sample forecast-error scale per lead time, from walk-forward CV.

    In-sample fit residuals systematically understate out-of-sample error
    (overfitting), and a constant band width ignores that a D+90 forecast is
    less certain than D+1. This estimates, for each lead 1..h, the RMSE of the
    actual CV forecast errors (bias included), forces the profile to be
    non-decreasing in the lead, and extrapolates leads beyond the CV horizon
    with sqrt(lead / h) growth (random-walk-style, the standard conservative
    default). Returns None when the series cannot sustain >= 2 full folds —
    callers then keep the model's own fallback bands.
    """
    folds = [
        f
        for f in _cv_folds(arr, fn, n_splits=n_splits, h=h, model_name=model_name)
        if len(f[0]) == h
    ]
    if len(folds) < 2:
        return None

    errs = np.stack([p - t for t, p in folds])  # (n_folds, h)
    if not np.all(np.isfinite(errs)):
        return None
    sigma = np.sqrt(np.mean(errs**2, axis=0))  # per-lead RMSE across folds
    sigma = np.maximum.accumulate(sigma)  # uncertainty never shrinks with lead

    if horizon <= h:
        return sigma[:horizon]
    tail_leads = np.arange(h + 1, horizon + 1, dtype=float)
    tail = sigma[-1] * np.sqrt(tail_leads / h)
    return np.concatenate([sigma, tail])


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_model_benchmarks(cv_horizon: int = 14) -> list[ModelBenchmark]:
    """Walk-forward benchmark of every model at the given CV horizon.

    ``cv_horizon`` matters: the best model at h=14 is not necessarily the best
    at h=90, so ``get_forecast`` requests a benchmark bucketed to the horizon
    it actually serves instead of always reusing the h=14 table.
    """
    # SEC-020: benchmark is computed on the caller's data — scope the key.
    _cache_key = scoped_key(f"forecast:benchmarks:{cv_horizon}")
    cached = app_cache.get(_cache_key)
    if cached is not None:
        return cached

    df = load_daily_costs()
    arr = df["y"].values.astype(float)
    # Shrink the CV horizon when the series cannot sustain a single
    # out-of-sample fold at the requested one (a fold needs n >= 30 + h).
    h_eff = int(max(1, min(cv_horizon, len(arr) - 30)))

    scores: list[dict] = []
    for name, (family, fn) in MODELS.items():
        metrics = _walk_forward_cv(arr, fn, h=h_eff, model_name=name)
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
                # No winner at all when no model completed a single CV fold
                # (series of 14-30 points): rank 1 would otherwise just be
                # insertion order sold as a champion.
                winner=(rank == 1 and mae is not None),
                cv_horizon=h_eff,
            )
        )
    app_cache.set(_cache_key, result)
    return result


def get_forecast(
    horizon: int = 60, model: str = "ETS"
) -> tuple[list[ForecastPoint], ForecastSummary]:
    resolved = resolve_model(model)
    if resolved is None:
        raise ValueError(f"Unknown model '{model}'. Available: {list(MODELS.keys())}")
    model = resolved

    # SEC-020: forecasts are computed on the caller's data — scope the key.
    # Startup precompute fills the anonymous scope only (demo parquet); a user
    # who ingested real events never receives the demo forecast, nor another
    # user's.
    _cache_key = scoped_key(f"forecast:{model}:{horizon}")
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
            details={"points": len(df), "min_required": _MIN_SERIES_POINTS},
        )
    arr = df["y"].values.astype(float)
    last_date = df["ds"].iloc[-1]

    _family, fn = MODELS[model]
    forecast_vals, ci80, ci95 = fn(arr, horizon)
    forecast_vals = np.asarray(forecast_vals, dtype=float)

    # Replace the model's own bands (in-sample residual std for most of the
    # registry) with empirical out-of-sample intervals estimated from the
    # walk-forward CV errors — the only construction whose 80/95% labels are
    # backed by observed forecast errors. ARIMA keeps its analytic intervals
    # (statsmodels conf_int already widens correctly with the lead). No
    # cosmetic clamping is applied: the previous 10×mean cap silently
    # destroyed the coverage guarantee the label promises.
    if model != "ARIMA":
        sigma = _cv_sigma_by_lead(arr, fn, horizon, model_name=model)
        if sigma is not None and float(np.max(sigma)) > 0:
            ci80 = np.stack(
                [np.maximum(0, forecast_vals - _Z80 * sigma), forecast_vals + _Z80 * sigma],
                axis=1,
            )
            ci95 = np.stack(
                [np.maximum(0, forecast_vals - _Z95 * sigma), forecast_vals + _Z95 * sigma],
                axis=1,
            )

    # Coherence with the DISPLAYED point (clamped at 0 below): on a decaying
    # series the raw forecast can go negative, leaving high95 = fc + z*sigma
    # below zero while low95 is floored at 0 — an inverted band with the
    # plotted point above its own upper bound. Clamp both bounds around the
    # displayed value instead.
    _fc_disp = np.maximum(0, forecast_vals)
    for _ci in (ci80, ci95):
        _ci[:, 0] = np.minimum(np.maximum(0, _ci[:, 0]), _fc_disp)
        _ci[:, 1] = np.maximum(_ci[:, 1], _fc_disp)

    # Last 30 actuals included for context in chart
    n_hist = 30
    hist = df.iloc[-n_hist:]

    points: list[ForecastPoint] = []

    for row in hist.itertuples():
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

    # KPI totals cover the FULL requested horizon. The previous [:30] slice
    # displayed "horizon 90 days" cards with a 30-day total (3× understated)
    # and divided a 7-day total by 30.
    total_fc = round(float(np.sum(np.maximum(0, forecast_vals))), 2)

    # Benchmark bucketed to the served horizon so best_model reflects the CV
    # performance at (approximately) this lead, not always h=14.
    bench = get_model_benchmarks(cv_horizon=cv_bucket(horizon))
    winner = next((b for b in bench if b.winner), bench[0])

    summary = ForecastSummary(
        horizon_days=horizon,
        total_forecast=total_fc,
        daily_avg_forecast=round(total_fc / horizon, 4),
        best_model=winner.model,
        best_model_mae=winner.mae,
        best_model_mape=winner.mape,
        models_evaluated=len(MODELS),
    )
    app_cache.set(_cache_key, (points, summary))
    return points, summary

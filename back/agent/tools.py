"""FinOps analysis surface exposed as registered agent tools.

Every function is registered via :mod:`agent.registry`; the registry produces
LangChain ``StructuredTool``s on demand for the LangGraph agent, and also
serves the MCP-style descriptor list at ``GET /api/tools``.
"""
from __future__ import annotations

from agent.registry import register


# ---------------------------------------------------------------------------
# Data provenance / status
# ---------------------------------------------------------------------------

@register(
    name="get_data_status",
    description=(
        "Report which data source powers the analytics right now — 'events' "
        "(live GCP sync or CSV upload), 'parquet_fallback' (bundled demo), or "
        "'empty'. Includes row counts, calendar period, and whether the "
        "BigQuery Billing Export is configured. Call this first to ground "
        "the conversation."
    ),
    category="data",
    tags=["provenance", "status"],
)
def get_data_status():
    from routes.routes_data import data_status
    return data_status()


# ---------------------------------------------------------------------------
# Global KPIs & service breakdown
# ---------------------------------------------------------------------------

@register(
    name="get_kpi_snapshot",
    description=(
        "Top-level cost KPIs: total_spend, daily_avg, trend_slope (€/day), "
        "forecast_next_30, anomaly_count, top_service, top_service_pct, "
        "data_points, period_start, period_end."
    ),
    category="analytics",
    tags=["kpi", "overview"],
)
def get_kpi_snapshot():
    from analysis.services import get_kpi
    return get_kpi()


@register(
    name="get_service_breakdown",
    description=(
        "Per-service cost totals, share %, coefficient of variation and "
        "cumulative %. Pareto-sorted descending. Use to identify the top "
        "cost drivers."
    ),
    category="analytics",
    tags=["services", "pareto"],
)
def get_service_breakdown():
    from analysis.services import get_service_shares
    return get_service_shares()


# ---------------------------------------------------------------------------
# Time-series diagnostics
# ---------------------------------------------------------------------------

@register(
    name="get_daily_series_summary",
    description=(
        "Last N days of aggregated cost (min 7, max 60) with 7-day moving "
        "average and 95% CI bands. Use for trend narratives or specific "
        "recent stretches."
    ),
    category="analytics",
    tags=["time-series"],
)
def get_daily_series_summary(last_n: int = 30):
    from analysis.timeseries import get_daily_series
    last_n = max(7, min(60, int(last_n)))
    return get_daily_series(last_n)


@register(
    name="get_descriptive_stats",
    description=(
        "Descriptive stats of the daily cost series: mean, median, std, CV, "
        "skewness, kurtosis, IQR, MAD, min, max."
    ),
    category="analytics",
    tags=["statistics"],
)
def get_descriptive_stats():
    from analysis.timeseries import get_descriptive_stats
    return get_descriptive_stats()


@register(
    name="get_stationarity",
    description=(
        "ADF and KPSS stationarity tests. Each returns (statistic, p_value, "
        "is_stationary, lags_used). Use to justify or reject linear "
        "extrapolation."
    ),
    category="analytics",
    tags=["stationarity"],
)
def get_stationarity():
    from analysis.timeseries import get_stationarity
    return get_stationarity()


@register(
    name="get_stl_strengths",
    description=(
        "Force of trend (Ft) and force of seasonality (Fs) from STL. Values "
        "close to 1 indicate strong structure; close to 0 means noise."
    ),
    category="analytics",
    tags=["decomposition", "stl"],
)
def get_stl_strengths():
    from analysis.timeseries import get_stl_decomposition
    _, strengths = get_stl_decomposition()
    return strengths


@register(
    name="get_anomalies",
    description=(
        "List days where |Z-score| exceeds z_threshold (default 2.0, "
        "clamped to [1, 4]). Returns only flagged days when any exist."
    ),
    category="analytics",
    tags=["anomalies"],
)
def get_anomalies(z_threshold: float = 2.0):
    from analysis.timeseries import get_anomalies
    z = max(1.0, min(4.0, float(z_threshold)))
    anomalies = get_anomalies(z)
    flagged = [row for row in anomalies if row.is_anomaly]
    return flagged if flagged else anomalies[:20]


# ---------------------------------------------------------------------------
# Forecasting
# ---------------------------------------------------------------------------

_ALLOWED_MODELS = {
    "AutoETS", "AutoTheta", "AutoARIMA",
    "Prophet (SES)", "N-HiTS (HW)", "TimesNet (SNaive)",
}


@register(
    name="get_forecast",
    description=(
        "Point forecast summary for `horizon` days (7-180) using one of the "
        "6 base models. Returns total, daily avg and best-model metrics — "
        "use get_ensemble_forecast for a bagged prediction with uncertainty."
    ),
    category="forecast",
    tags=["forecast"],
)
def get_forecast(horizon: int = 60, model: str = "AutoETS"):
    from forecast.engine import get_forecast
    if model not in _ALLOWED_MODELS:
        return {"error": f"unknown model '{model}'", "allowed": sorted(_ALLOWED_MODELS)}
    h = max(7, min(180, int(horizon)))
    _, summary = get_forecast(h, model)
    return summary


@register(
    name="get_model_benchmarks",
    description=(
        "Walk-forward cross-validation leaderboard across all 6 models "
        "(MAE / RMSE / MAPE / R²). Answers 'which model should I trust?'."
    ),
    category="forecast",
    tags=["benchmarks"],
)
def get_model_benchmarks():
    from forecast.engine import get_model_benchmarks
    return get_model_benchmarks()


@register(
    name="get_ensemble_forecast",
    description=(
        "Bagged + inverse-MAE weighted ensemble across all 6 base models, "
        "with per-model bias/variance decomposition. Use when the user asks "
        "about model uncertainty or wants a robust prediction."
    ),
    category="forecast",
    tags=["ensemble", "bias-variance"],
)
def get_ensemble_forecast(horizon: int = 60):
    from analysis.advanced import compute_ensemble_forecast
    h = max(7, min(180, int(horizon)))
    r = compute_ensemble_forecast(horizon=h)
    return {
        "horizon": r.horizon,
        "base_models": r.base_models,
        "weights": r.weights,
        "bias_variance": [bv.model_dump() for bv in r.bias_variance],
        "n_points": len(r.points),
    }


# ---------------------------------------------------------------------------
# Advanced analytics
# ---------------------------------------------------------------------------

@register(
    name="get_outliers",
    description=(
        "Run 5 outlier-detection methods (Z-score, modified Z / MAD, IQR, "
        "Isolation Forest, LOF) plus robust Mahalanobis on the per-service "
        "matrix. Returns summary counts + flagged days (agreement across "
        "methods matters)."
    ),
    category="advanced",
    tags=["outliers"],
)
def get_outliers():
    from analysis.advanced import compute_outliers
    result = compute_outliers()
    flagged = [
        r for r in result.rows
        if r.iqr_flag or r.isolation_flag or r.lof_flag or abs(r.zscore) > 2
    ]
    return {
        "summary": [s.model_dump() for s in result.summary],
        "flagged_rows": [r.model_dump() for r in flagged],
        "mahalanobis_outliers": [m.model_dump() for m in result.mahalanobis if m.is_outlier],
    }


@register(
    name="get_drift",
    description=(
        "Distribution drift between the first half (reference) and the second "
        "half (current) of the series. Returns KS test, PSI with verdict "
        "(stable/moderate/significant) and Page-Hinkley change-point count."
    ),
    category="advanced",
    tags=["drift"],
)
def get_drift():
    from analysis.advanced import compute_drift
    r = compute_drift()
    return {
        "ks": r.ks.model_dump(),
        "psi": {"psi": r.psi.psi, "verdict": r.psi.verdict, "n_bins": len(r.psi.bins)},
        "n_changepoints_detected": r.n_changepoints_detected,
    }


@register(
    name="get_distribution",
    description=(
        "Distributional diagnostics: skewness, excess kurtosis, Box-Cox "
        "lambda, and Jarque-Bera / Shapiro-Wilk / D'Agostino K² normality "
        "tests."
    ),
    category="advanced",
    tags=["distribution", "normality"],
)
def get_distribution():
    from analysis.advanced import compute_distribution
    r = compute_distribution()
    return {
        "skewness": r.skewness,
        "kurtosis": r.kurtosis,
        "boxcox_lambda": r.boxcox_lambda,
        "normality_tests": [t.model_dump() for t in r.normality_tests],
    }


@register(
    name="get_missingness",
    description=(
        "Report calendar-day gaps, per-service missing %, and a coarse hint "
        "on the mechanism (MCAR / MAR / MNAR-like)."
    ),
    category="advanced",
    tags=["missing-data"],
)
def get_missingness():
    from analysis.advanced import compute_missingness
    return compute_missingness()


@register(
    name="get_pca_summary",
    description=(
        "PCA on the per-service daily cost matrix. Returns each component's "
        "variance ratio and its top-5 service loadings."
    ),
    category="advanced",
    tags=["pca", "dim-reduction"],
)
def get_pca_summary(n_components: int = 3):
    from analysis.advanced import compute_dim_reduction
    n = max(2, min(5, int(n_components)))
    r = compute_dim_reduction(n_components=n, run_tsne=False)
    return {
        "n_services": r.n_services,
        "n_days": r.n_days,
        "total_variance_explained": r.total_variance_explained,
        "components": [c.model_dump() for c in r.pca_components],
    }


# ---------------------------------------------------------------------------
# Cloud provider status (read-only)
# ---------------------------------------------------------------------------

@register(
    name="get_aws_status",
    description=(
        "Report whether the backend has usable AWS credentials via STS "
        "GetCallerIdentity. Returns authenticated, account_id, arn, region."
    ),
    category="cloud",
    tags=["aws", "auth"],
)
def get_aws_status():
    from routes.routes_aws import aws_status
    return aws_status()


# ---------------------------------------------------------------------------
# Public bundle used by the LangGraph agent — generated from the registry.
# ---------------------------------------------------------------------------

def get_all_langchain_tools():
    """Return every registered tool adapted as LangChain StructuredTools."""
    from agent.registry import as_langchain_tools
    return as_langchain_tools()

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from analysis.advanced import (
    compute_dim_reduction,
    compute_distribution,
    compute_drift,
    compute_ensemble_forecast,
    compute_missingness,
    compute_outliers,
    compute_scaling,
)
from core.cache import app_cache
from schemas.advanced import (
    DimReductionResponse,
    DistributionResponse,
    DriftResponse,
    EnsembleForecastResponse,
    MissingnessResponse,
    OutliersResponse,
    ScalingResponse,
)

router = APIRouter(prefix="/api/analysis", tags=["advanced-analysis"])


# SEC: float query params are quantized before being embedded in a cache key.
# Without this, ?z_threshold=2.0000001 and ?z_threshold=2.0000002 would create
# distinct entries; an unauthenticated caller can inflate the cache without
# bound. 2 decimals is far finer than any meaningful choice for these params.
def _q(x: float) -> str:
    return f"{round(x, 2):.2f}"


@router.get("/outliers", response_model=OutliersResponse)
def outliers(
    z_threshold: Annotated[float, Query(ge=1.0, le=5.0)] = 2.0,
    iqr_multiplier: Annotated[float, Query(ge=1.0, le=3.0)] = 1.5,
) -> OutliersResponse:
    """5 outlier-detection methods run in parallel on the daily cost series.

    Includes: Z-score, modified Z (MAD-based), IQR / Tukey fences,
    Isolation Forest, Local Outlier Factor. A 6th method — robust Mahalanobis
    distance via Minimum Covariance Determinant — runs on the per-service
    matrix and appears in the ``mahalanobis`` field when there are at least
    2 services and 10 days of history.
    """
    cache_key = f"analysis:outliers:{_q(z_threshold)}:{_q(iqr_multiplier)}"
    cached = app_cache.get(cache_key)
    if cached is not None:
        return cached
    result = compute_outliers(z_thresh=z_threshold, iqr_mult=iqr_multiplier)
    app_cache.set(cache_key, result)
    return result


@router.get("/drift", response_model=DriftResponse)
def drift(
    reference_frac: Annotated[float, Query(gt=0.1, lt=0.9)] = 0.5,
    psi_bins: Annotated[int, Query(ge=5, le=20)] = 10,
) -> DriftResponse:
    """Detect distribution drift between the first ``reference_frac`` of the
    series (the reference window) and the remainder (current window).

    Reports:
    - Kolmogorov-Smirnov two-sample test (p<0.05 → distributions differ)
    - Population Stability Index (PSI) with a verdict thresholded at 0.1 / 0.25
    - Page-Hinkley online change-point statistic across every day
    """
    cache_key = f"analysis:drift:{_q(reference_frac)}:{psi_bins}"
    cached = app_cache.get(cache_key)
    if cached is not None:
        return cached
    result = compute_drift(reference_frac=reference_frac, psi_bins=psi_bins)
    app_cache.set(cache_key, result)
    return result


@router.get("/distribution", response_model=DistributionResponse)
def distribution() -> DistributionResponse:
    """Distributional diagnostics: skewness, excess kurtosis, Box-Cox lambda,
    3 normality tests (Jarque-Bera, Shapiro-Wilk, D'Agostino K^2) and QQ-plot
    coordinates for visual inspection.
    """
    cache_key = "analysis:distribution"
    cached = app_cache.get(cache_key)
    if cached is not None:
        return cached
    result = compute_distribution()
    app_cache.set(cache_key, result)
    return result


@router.get("/scaling", response_model=ScalingResponse)
def scaling() -> ScalingResponse:
    """Same series scaled 3 different ways for visual comparison.

    - **Standard**: (x - mean) / std — sensitive to outliers, assumes ~Gaussian
    - **MinMax**: (x - min) / (max - min) — bounds to [0,1], very sensitive to outliers
    - **Robust**: (x - median) / IQR — outlier-resistant, best default for real cost data
    """
    cache_key = "analysis:scaling"
    cached = app_cache.get(cache_key)
    if cached is not None:
        return cached
    result = compute_scaling()
    app_cache.set(cache_key, result)
    return result


@router.get("/missing", response_model=MissingnessResponse)
def missing() -> MissingnessResponse:
    """Missing-data audit.

    Reports calendar-day gaps, per-service missing %, and a coarse mechanism
    hint (MCAR / MAR / MNAR-like) derived from the correlation between
    missingness and cost level.
    """
    cache_key = "analysis:missing"
    cached = app_cache.get(cache_key)
    if cached is not None:
        return cached
    result = compute_missingness()
    app_cache.set(cache_key, result)
    return result


@router.get("/dim-reduction", response_model=DimReductionResponse)
def dim_reduction(
    n_components: Annotated[int, Query(ge=2, le=10)] = 5,
    run_tsne: Annotated[bool, Query()] = True,
) -> DimReductionResponse:
    """PCA (variance decomposition + top loadings per component) plus optional
    t-SNE 2D projection of services, using the per-service daily cost matrix.

    Useful to spot which services drive cost variance and which services cluster
    together in usage patterns.
    """
    cache_key = f"analysis:dimred:{n_components}:{run_tsne}"
    cached = app_cache.get(cache_key)
    if cached is not None:
        return cached
    result = compute_dim_reduction(n_components=n_components, run_tsne=run_tsne)
    app_cache.set(cache_key, result)
    return result


@router.get("/ensemble-forecast", response_model=EnsembleForecastResponse)
def ensemble_forecast(
    horizon: Annotated[int, Query(ge=7, le=180)] = 60,
) -> EnsembleForecastResponse:
    """Bagged + stacked forecast across the 6 base models, with bias-variance
    decomposition per model computed on walk-forward CV folds.

    - **mean_ensemble**: unweighted average of all 6 models
    - **weighted_ensemble**: inverse-MAE weighted average (better models weigh more)
    - **lo80/hi80**: 10th/90th percentile of the 6 model outputs (cross-model spread)
    - **bias_variance**: per-model bias² + variance + total MSE, sorted ascending
    """
    cache_key = f"analysis:ensemble:{horizon}"
    cached = app_cache.get(cache_key)
    if cached is not None:
        return cached
    result = compute_ensemble_forecast(horizon=horizon)
    app_cache.set(cache_key, result)
    return result

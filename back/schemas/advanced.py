from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Outliers
# ---------------------------------------------------------------------------

class OutlierRow(BaseModel):
    date: str
    cost: float
    zscore: float = Field(description="Standard Z-score")
    modified_zscore: float = Field(description="Iglewicz-Hoaglin MAD-based Z")
    iqr_flag: bool = Field(description="True if outside Tukey 1.5*IQR fences")
    isolation_score: float = Field(description="Isolation Forest anomaly score (higher = more anomalous)")
    isolation_flag: bool
    lof_score: float = Field(description="Local Outlier Factor score (higher = more anomalous)")
    lof_flag: bool


class MahalanobisRow(BaseModel):
    date: str
    distance: float
    p_value: float
    is_outlier: bool


class OutlierSummary(BaseModel):
    method: str
    flagged_count: int
    flagged_pct: float
    threshold: Optional[float] = None


class OutliersResponse(BaseModel):
    rows: list[OutlierRow]
    summary: list[OutlierSummary]
    mahalanobis: list[MahalanobisRow] = Field(
        default_factory=list,
        description="Multivariate outliers over the per-service cost matrix. "
        "Empty when the per-service DataFrame has fewer than 2 columns.",
    )


# ---------------------------------------------------------------------------
# Drift
# ---------------------------------------------------------------------------

class KSResult(BaseModel):
    statistic: float
    p_value: float
    drift_detected: bool
    reference_period: str
    current_period: str
    n_ref: int
    n_cur: int


class PSIBin(BaseModel):
    lower: float
    upper: float
    ref_pct: float
    cur_pct: float
    contribution: float


class PSIResult(BaseModel):
    psi: float
    verdict: str = Field(
        description="'stable' (<0.1), 'moderate' (0.1-0.25), 'significant' (>0.25)"
    )
    bins: list[PSIBin]


class PageHinkleyPoint(BaseModel):
    date: str
    ph_stat: float
    change_detected: bool


class DriftResponse(BaseModel):
    ks: KSResult
    psi: PSIResult
    page_hinkley: list[PageHinkleyPoint]
    n_changepoints_detected: int


# ---------------------------------------------------------------------------
# Distribution
# ---------------------------------------------------------------------------

class NormalityTest(BaseModel):
    name: str
    statistic: float
    p_value: float
    is_normal: bool


class DistributionResponse(BaseModel):
    skewness: float
    kurtosis: float = Field(description="Excess kurtosis (0 for normal)")
    boxcox_lambda: Optional[float] = Field(default=None, description="MLE Box-Cox lambda; None if series has non-positive values")
    normality_tests: list[NormalityTest]
    qq_points: list[list[float]] = Field(
        description="Pairs of (theoretical_quantile, sample_quantile) for QQ plot"
    )


# ---------------------------------------------------------------------------
# Scaling
# ---------------------------------------------------------------------------

class ScaledSeriesPoint(BaseModel):
    date: str
    standard: float = Field(description="StandardScaler (z-score)")
    minmax: float = Field(description="MinMaxScaler in [0,1]")
    robust: float = Field(description="RobustScaler (IQR-based, robust to outliers)")


class ScalingResponse(BaseModel):
    points: list[ScaledSeriesPoint]
    stats: dict = Field(
        description="Center/scale parameters used by each scaler (mean, std, min, max, median, iqr)."
    )


# ---------------------------------------------------------------------------
# Missing data / gaps
# ---------------------------------------------------------------------------

class GapRow(BaseModel):
    start: str
    end: str
    days: int


class MissingnessResponse(BaseModel):
    calendar_days_expected: int
    actual_days: int
    missing_days: int
    gaps: list[GapRow]
    per_service_missing_pct: dict[str, float]
    mechanism_hint: str = Field(
        description="Coarse hint: 'MCAR-like', 'MAR-like', 'MNAR-like', or 'insufficient-data'."
    )


# ---------------------------------------------------------------------------
# Dimensionality reduction
# ---------------------------------------------------------------------------

class PCAComponent(BaseModel):
    component: int
    variance_ratio: float
    cumulative_ratio: float
    top_loadings: dict[str, float] = Field(
        description="Top-5 service loadings on this component (positive and negative)."
    )


class DimReductionResponse(BaseModel):
    n_services: int
    n_days: int
    pca_components: list[PCAComponent]
    total_variance_explained: float
    tsne_2d: list[dict] = Field(
        default_factory=list,
        description="Per-service 2D t-SNE coordinates: [{service, x, y}]",
    )


# ---------------------------------------------------------------------------
# Ensemble forecast + bias/variance
# ---------------------------------------------------------------------------

class EnsembleForecastPoint(BaseModel):
    date: str
    actual: Optional[float] = None
    mean_ensemble: float = Field(description="Simple average across all base models")
    weighted_ensemble: float = Field(description="Inverse-MAE-weighted average across base models")
    lo80: float
    hi80: float


class BiasVarianceRow(BaseModel):
    model: str
    bias_squared: float
    variance: float
    total_error: float


class EnsembleForecastResponse(BaseModel):
    horizon: int
    base_models: list[str]
    weights: dict[str, float]
    points: list[EnsembleForecastPoint]
    bias_variance: list[BiasVarianceRow]

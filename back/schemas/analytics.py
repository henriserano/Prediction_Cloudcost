from __future__ import annotations

from pydantic import BaseModel, Field


class DailyPoint(BaseModel):
    date: str
    cost: float
    ma7: float
    ci_low: float
    ci_high: float


class ServiceShare(BaseModel):
    service: str
    cost: float
    pct: float
    cv: float
    cum_pct: float
    category: str = Field(
        default="other",
        description="Coarse-grained bucket: compute | database | storage | "
        "analytics | ai_ml | network | security | observability | other. See "
        "analysis/service_taxonomy.py.",
    )


class AnomalyPoint(BaseModel):
    date: str
    cost: float
    zscore: float
    is_anomaly: bool


class STLPoint(BaseModel):
    date: str
    trend: float
    seasonal: float
    residual: float


class DescriptiveStats(BaseModel):
    mean: float
    median: float
    std: float
    cv: float
    skewness: float
    kurtosis: float
    iqr: float
    mad: float
    min: float
    max: float


class StationarityTest(BaseModel):
    statistic: float
    p_value: float
    is_stationary: bool
    lags_used: int


class StationarityResult(BaseModel):
    adf: StationarityTest
    kpss: StationarityTest


class ACFPoint(BaseModel):
    lag: int
    acf: float
    pacf: float


class KPIData(BaseModel):
    total_spend: float
    daily_avg: float
    trend_slope: float
    forecast_next_30: float
    anomaly_count: int
    top_service: str
    top_service_pct: float
    data_points: int
    period_start: str
    period_end: str


class STLStrengths(BaseModel):
    ft: float = Field(description="Force of trend (Ft)")
    fs: float = Field(description="Force of seasonality (Fs)")
    period: int

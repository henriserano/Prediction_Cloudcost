from __future__ import annotations

from pydantic import BaseModel


class ForecastPoint(BaseModel):
    date: str
    forecast: float
    low80: float
    high80: float
    low95: float
    high95: float
    actual: float | None = None


class ModelBenchmark(BaseModel):
    rank: int
    model: str
    family: str
    # Metrics are None when the model failed every CV fold or produced
    # non-finite values — inf/NaN are never serialized (invalid JSON).
    mae: float | None = None
    rmse: float | None = None
    mape: float | None = None
    r2: float | None = None
    score: float | None = None
    winner: bool
    # Effective walk-forward CV horizon (days) the metrics were computed at —
    # the ranking is only meaningful for forecasts of a comparable lead.
    cv_horizon: int = 14


class ForecastSummary(BaseModel):
    horizon_days: int
    total_forecast: float
    daily_avg_forecast: float
    best_model: str
    best_model_mae: float | None = None
    best_model_mape: float | None = None
    models_evaluated: int

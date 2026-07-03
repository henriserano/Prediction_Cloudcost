from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class ForecastPoint(BaseModel):
    date: str
    forecast: float
    low80: float
    high80: float
    low95: float
    high95: float
    actual: Optional[float] = None


class ModelBenchmark(BaseModel):
    rank: int
    model: str
    family: str
    # Metrics are None when the model failed every CV fold or produced
    # non-finite values — inf/NaN are never serialized (invalid JSON).
    mae: Optional[float] = None
    rmse: Optional[float] = None
    mape: Optional[float] = None
    r2: Optional[float] = None
    score: Optional[float] = None
    winner: bool


class ForecastSummary(BaseModel):
    horizon_days: int
    total_forecast: float
    daily_avg_forecast: float
    best_model: str
    best_model_mae: Optional[float] = None
    best_model_mape: Optional[float] = None
    models_evaluated: int

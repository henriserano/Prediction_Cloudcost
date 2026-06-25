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
    mae: float
    rmse: float
    mape: float
    r2: float
    score: float
    winner: bool


class ForecastSummary(BaseModel):
    horizon_days: int
    total_forecast: float
    daily_avg_forecast: float
    best_model: str
    best_model_mae: float
    best_model_mape: float
    models_evaluated: int

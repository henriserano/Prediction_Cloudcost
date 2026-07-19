from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.errors import BadRequest
from core.session import require_current_user_id
from forecast.engine import MODELS, cv_bucket, get_forecast, get_model_benchmarks, resolve_model
from schemas.forecast import ForecastPoint, ForecastSummary, ModelBenchmark

# SEC-020: forecast routes are per-user (analytics pipeline is fed by the
# authenticated caller's slice of the events store).
router = APIRouter(
    prefix="/api/forecast",
    tags=["forecast"],
    dependencies=[Depends(require_current_user_id)],
)


@router.get("", response_model=list[ForecastPoint])
def forecast(
    horizon: Annotated[int, Query(ge=7, le=180, description="Forecast horizon in days")] = 60,
    model: Annotated[str, Query(description="Model name (legacy aliases accepted)")] = "ETS",
):
    """
    Forecast series for the given horizon.

    Returns the last 30 historical actuals + `horizon` future points,
    each with 80% and 95% confidence intervals.
    """
    resolved = resolve_model(model)
    if resolved is None:
        raise BadRequest(
            f"Unknown model '{model}'.",
            details={"available": list(MODELS.keys())},
        )
    points, _ = get_forecast(horizon, resolved)
    return points


@router.get("/summary", response_model=ForecastSummary)
def forecast_summary(
    horizon: Annotated[int, Query(ge=7, le=180)] = 60,
    model: Annotated[str, Query()] = "ETS",
):
    """Forecast KPI cards: total, daily avg, best model metrics."""
    resolved = resolve_model(model)
    if resolved is None:
        raise BadRequest(f"Unknown model '{model}'.", details={"available": list(MODELS.keys())})
    _, summary = get_forecast(horizon, resolved)
    return summary


@router.get("/models", response_model=list[ModelBenchmark])
def model_benchmarks(
    horizon: Annotated[
        int | None,
        Query(ge=7, le=180, description="Align the CV bucket with the displayed forecast horizon"),
    ] = None,
):
    """
    Walk-forward cross-validation benchmark across all 6 models.
    Sorted by MAE ascending; winner=true for the best model.

    Pass ``?horizon=`` to receive the benchmark bucket (7/14/28) that
    ``/forecast`` uses for that horizon — otherwise the table shown next to
    the forecast could elect a different champion than ``summary.best_model``.
    """
    if horizon is not None:
        return get_model_benchmarks(cv_bucket(horizon))
    return get_model_benchmarks()


@router.get("/models/list")
def model_list():
    """List of available model names."""
    return {"models": list(MODELS.keys())}

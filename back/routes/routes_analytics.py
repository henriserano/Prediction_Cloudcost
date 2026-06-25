from __future__ import annotations

from typing import List, Annotated

from fastapi import APIRouter, Query

from analysis.timeseries import (
    get_acf_pacf,
    get_anomalies,
    get_daily_series,
    get_descriptive_stats,
    get_stationarity,
    get_stl_decomposition,
)
from analysis.services import get_kpi, get_service_shares
from schemas.analytics import (
    ACFPoint,
    AnomalyPoint,
    DescriptiveStats,
    DailyPoint,
    KPIData,
    STLPoint,
    STLStrengths,
    ServiceShare,
    StationarityResult,
)
from core.errors import BadRequest

router = APIRouter(prefix="/api", tags=["analytics"])


@router.get("/kpi", response_model=KPIData)
def kpi():
    """Global KPI aggregates for the dashboard header cards."""
    return get_kpi()


@router.get("/daily", response_model=List[DailyPoint])
def daily_costs(
    last_n: Annotated[int | None, Query(ge=7, le=365, description="Limit to last N days")] = None,
):
    """Daily aggregated costs with 7-day MA and 95% CI bands."""
    return get_daily_series(last_n)


@router.get("/services", response_model=List[ServiceShare])
def services():
    """Per-service cost totals, share %, CV, and cumulative % (Pareto-sorted)."""
    return get_service_shares()


@router.get("/anomalies", response_model=List[AnomalyPoint])
def anomalies(
    z_threshold: Annotated[float, Query(ge=1.0, le=4.0)] = 2.0,
):
    """All daily points with Z-scores. is_anomaly=true when |Z| > z_threshold."""
    return get_anomalies(z_threshold)


@router.get("/stats", response_model=DescriptiveStats)
def descriptive_stats():
    """Full descriptive statistics of the daily cost distribution."""
    return get_descriptive_stats()


@router.get("/stationarity", response_model=StationarityResult)
def stationarity():
    """ADF and KPSS stationarity tests on the daily cost series."""
    return get_stationarity()


@router.get("/stl", response_model=List[STLPoint])
def stl():
    """STL decomposition (trend + seasonal + residual) for every day."""
    points, _ = get_stl_decomposition()
    return points


@router.get("/stl/strengths", response_model=STLStrengths)
def stl_strengths():
    """Force of trend (Ft) and force of seasonality (Fs) from STL."""
    _, strengths = get_stl_decomposition()
    return strengths


@router.get("/acf", response_model=List[ACFPoint])
def acf_pacf(
    nlags: Annotated[int, Query(ge=5, le=60)] = 28,
):
    """ACF and PACF values up to `nlags` lags."""
    return get_acf_pacf(nlags)

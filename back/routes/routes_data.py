from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.config import get_settings
from core.session import require_current_user_id
from data.loader import get_last_source, load_daily_costs, load_daily_per_service

router = APIRouter(
    prefix="/api/data",
    tags=["data"],
    dependencies=[Depends(require_current_user_id)],
)


class DataStatus(BaseModel):
    """Reports which data source powers analytics/forecast right now.

    ``source`` is one of:
      - ``"events"``     — live data from /api/gcp/sync or /api/events
      - ``"parquet_fallback"`` — bundled demo data (only when explicitly enabled)
      - ``"empty"``      — nothing ingested yet; UI should prompt for a sync
    """

    source: str
    rows_daily: int
    rows_per_service: int
    services_count: int
    period_start: str | None = None
    period_end: str | None = None
    parquet_fallback_enabled: bool
    bigquery_export_configured: bool = Field(
        description="True when GCP_BILLING_EXPORT_* env vars are all set."
    )


@router.get("/status", response_model=DataStatus)
def data_status() -> DataStatus:
    """Report the current data provenance and volume."""
    settings = get_settings()

    daily = load_daily_costs()
    per_svc = load_daily_per_service()
    last = get_last_source()

    source = last.get("daily_costs") or last.get("daily_per_service") or "empty"

    period_start = None
    period_end = None
    if len(daily) > 0 and "ds" in daily.columns:
        period_start = daily["ds"].min().strftime("%Y-%m-%d")
        period_end = daily["ds"].max().strftime("%Y-%m-%d")

    services_count = max(0, len([c for c in per_svc.columns if c != "ds"]))

    bq_configured = bool(
        settings.gcp_billing_export_project
        and settings.gcp_billing_export_dataset
        and settings.gcp_billing_export_table
    )

    return DataStatus(
        source=source,
        rows_daily=len(daily),
        rows_per_service=len(per_svc),
        services_count=services_count,
        period_start=period_start,
        period_end=period_end,
        parquet_fallback_enabled=settings.data_allow_parquet_fallback,
        bigquery_export_configured=bq_configured,
    )

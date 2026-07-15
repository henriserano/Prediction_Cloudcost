"""Response schema for /api/events/billing.

Mirrors the shape returned by the three cloud billing endpoints
(:class:`schemas.gcp.GCPBillingResponse` and siblings) so the frontend's
portfolio aggregator can merge local-store data alongside cloud data without
a provider-specific branch.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .gcp import DateRange


class LocalBillingByService(BaseModel):
    service: str
    cost: float
    pct: float


class LocalBillingByMonth(BaseModel):
    month: str  # YYYY-MM
    cost: float


class LocalBillingResponse(BaseModel):
    period: DateRange
    total: float
    by_service: list[LocalBillingByService]
    by_month: list[LocalBillingByMonth]
    currency: str = Field(default="EUR")
    source: str = Field(
        description="Origin of the events being aggregated: 'events', "
        "'parquet_fallback', or 'empty'.",
    )
    event_count: int

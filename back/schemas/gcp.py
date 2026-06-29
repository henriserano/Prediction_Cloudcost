from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Events ingestion
# ---------------------------------------------------------------------------

class BillingEvent(BaseModel):
    date: str = Field(description="ISO date string YYYY-MM-DD")
    service: str = Field(description="GCP service name")
    cost: float = Field(description="Cost in euros")
    description: Optional[str] = Field(default=None, description="Optional line-item description")


class EventsIngestRequest(BaseModel):
    events: list[BillingEvent] = Field(description="List of billing events to ingest")
    replace: bool = Field(default=False, description="If True, replace existing in-memory data; else append")


class PreviewKPI(BaseModel):
    total_spend: float
    daily_avg: float


class DateRange(BaseModel):
    start: str
    end: str


class EventsIngestResponse(BaseModel):
    ingested: int = Field(description="Number of rows ingested in this request")
    total_rows: int = Field(description="Total rows now in the in-memory store")
    date_range: DateRange
    preview_kpi: PreviewKPI


# ---------------------------------------------------------------------------
# GCP auth status
# ---------------------------------------------------------------------------

class GCPAuthStatus(BaseModel):
    authenticated: bool
    email: Optional[str] = None
    project_id: Optional[str] = None


# ---------------------------------------------------------------------------
# GCP projects
# ---------------------------------------------------------------------------

class GCPProject(BaseModel):
    project_id: str
    name: str
    project_number: str


# ---------------------------------------------------------------------------
# GCP billing
# ---------------------------------------------------------------------------

class GCPBillingByService(BaseModel):
    service: str
    cost: float
    pct: float


class GCPBillingByMonth(BaseModel):
    month: str
    cost: float


class GCPBillingResponse(BaseModel):
    project_id: str
    period: DateRange
    total: float
    by_service: list[GCPBillingByService]
    by_month: list[GCPBillingByMonth]
    currency: str = Field(default="EUR")


# ---------------------------------------------------------------------------
# GCP Cloud Logging
# ---------------------------------------------------------------------------

class GCPLogEntry(BaseModel):
    timestamp: str
    severity: str
    resource_type: str
    service: str
    message: str
    labels: dict[str, str] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# GCP Service Usage
# ---------------------------------------------------------------------------

class GCPService(BaseModel):
    service_id: str
    name: str
    enabled: bool
    category: str

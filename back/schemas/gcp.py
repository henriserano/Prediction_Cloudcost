from __future__ import annotations

import re
from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_MAX_EVENTS_PER_REQUEST = 10_000
_MAX_COST = 1_000_000.0  # implausibly large value ceiling (€)

# ---------------------------------------------------------------------------
# Events ingestion
# ---------------------------------------------------------------------------

class BillingEvent(BaseModel):
    date: str = Field(description="ISO date string YYYY-MM-DD")
    service: str = Field(max_length=200, description="GCP service name")
    cost: float = Field(description="Cost in euros")
    description: Optional[str] = Field(default=None, description="Optional line-item description")

    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        if not _DATE_RE.match(v):
            raise ValueError(f"date must match YYYY-MM-DD, got '{v}'")
        return v

    @field_validator("cost")
    @classmethod
    def validate_cost(cls, v: float) -> float:
        if v < 0:
            raise ValueError(f"cost must be >= 0, got {v}")
        if v > _MAX_COST:
            raise ValueError(f"cost exceeds maximum allowed value of {_MAX_COST}, got {v}")
        return v


class EventsIngestRequest(BaseModel):
    events: list[BillingEvent] = Field(
        description="List of billing events to ingest",
        max_length=_MAX_EVENTS_PER_REQUEST,
    )
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

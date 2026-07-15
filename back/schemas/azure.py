from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

from schemas.gcp import DateRange

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_GUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class AzureSyncRequest(BaseModel):
    """Ingest Azure Cost Management data into the FinOps store."""

    subscription_id: str | None = Field(
        default=None,
        description="Filter to a specific subscription. None = the active subscription cached at unlock time.",
    )
    months: int = Field(default=6, ge=1, le=24)
    replace: bool = Field(
        default=True,
        description="True = wipe the current store and load Azure data as the sole source. "
        "False = append (useful to merge multiple subscriptions).",
    )

    @field_validator("subscription_id")
    @classmethod
    def _validate_sub(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not _GUID_RE.match(v):
            raise ValueError(f"subscription_id must be a GUID, got '{v}'")
        return v


class AzureSyncResponse(BaseModel):
    ingested: int
    subscription_id: str | None
    period_start: str
    period_end: str
    services_count: int
    total_cost: float
    currency: str
    replaced: bool


class AzureSubscription(BaseModel):
    """One Azure subscription visible to the caller's Service Principal."""

    subscription_id: str
    name: str
    state: str | None = None
    tenant_id: str | None = None


class AzureAuthStatus(BaseModel):
    """Reports whether the backend has usable Azure credentials for the caller.

    Populated by acquiring a token from Azure AD using the stored Service
    Principal (tenant_id + client_id + client_secret). No secret ever returned.
    """

    authenticated: bool
    tenant_id: str | None = None
    subscription_id: str | None = None
    display_name: str | None = Field(
        default=None,
        description="Human-readable identity: SP display name or subscription name",
    )
    location: str | None = None
    detail: str | None = Field(
        default=None,
        description="Human-readable error/context when authenticated is False",
    )


class AzureBillingByService(BaseModel):
    service: str
    cost: float
    pct: float
    category: str = Field(default="other")


class AzureBillingByMonth(BaseModel):
    month: str = Field(description="YYYY-MM")
    cost: float


class AzureBillingByDay(BaseModel):
    date: str = Field(description="YYYY-MM-DD")
    cost: float


class AzureBillingResponse(BaseModel):
    subscription_id: str | None
    period: DateRange
    total: float
    by_service: list[AzureBillingByService]
    by_month: list[AzureBillingByMonth]
    by_day: list[AzureBillingByDay] = Field(default_factory=list)
    currency: str = Field(default="EUR")
    source: str = Field(
        default="cost_management",
        description="Origin of the data: 'cost_management' (real Azure API) or a fallback identifier.",
    )
    granularity: str = Field(default="Daily")


class AzureBillingQuery(BaseModel):
    """Optional query params validated up-front to prevent invalid Cost Management calls."""

    start: str | None = Field(default=None, description="YYYY-MM-DD")
    end: str | None = Field(default=None, description="YYYY-MM-DD")
    granularity: str = Field(default="Daily")

    @field_validator("start", "end")
    @classmethod
    def _validate_date(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not _DATE_RE.match(v):
            raise ValueError(f"date must match YYYY-MM-DD, got '{v}'")
        return v

    @field_validator("granularity")
    @classmethod
    def _validate_granularity(cls, v: str) -> str:
        allowed = {"Daily", "Monthly"}
        if v not in allowed:
            raise ValueError(f"granularity must be one of {sorted(allowed)}, got '{v}'")
        return v

from __future__ import annotations

import re
from typing import Optional
from pydantic import BaseModel, Field, field_validator

from schemas.gcp import DateRange

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class AWSSyncRequest(BaseModel):
    """Ingest AWS Cost Explorer data into the FinOps store."""

    account_id: Optional[str] = Field(
        default=None,
        description="Filter to a specific linked account (Organizations only). "
        "None = the whole payer account.",
    )
    months: int = Field(default=6, ge=1, le=24)
    replace: bool = Field(
        default=True,
        description="True = wipe the current store and load AWS data as the sole "
        "source. False = append (useful to merge multiple accounts).",
    )


class AWSSyncResponse(BaseModel):
    ingested: int
    account_id: Optional[str]
    period_start: str
    period_end: str
    services_count: int
    total_cost: float
    currency: str
    replaced: bool


class AWSAccount(BaseModel):
    """One AWS account visible to the caller.

    Comes from either the Organizations API (management/delegated admin
    account) or STS caller-identity (single-account IAM user). The
    ``source`` field records which path resolved it so the UI can hint at
    the "single account" case.
    """

    account_id: str
    name: str
    email: Optional[str] = None
    status: Optional[str] = None
    source: str = Field(
        default="sts",
        description="'organizations' when discovered via ListAccounts, 'sts' when fallback",
    )


class AWSAuthStatus(BaseModel):
    """Reports whether the backend has usable AWS credentials.

    Populated by calling STS GetCallerIdentity with the boto3 default credential
    chain (env vars, shared credentials file, ECS task role, EC2 instance
    profile, etc.). No secrets are ever returned to the client.
    """

    authenticated: bool
    account_id: Optional[str] = Field(default=None, description="12-digit AWS account ID")
    arn: Optional[str] = Field(default=None, description="IAM ARN of the caller")
    user_id: Optional[str] = Field(default=None)
    region: Optional[str] = Field(default=None)
    detail: Optional[str] = Field(
        default=None,
        description="Human-readable error/context when authenticated is False",
    )


class AWSBillingByService(BaseModel):
    service: str
    cost: float
    pct: float
    category: str = Field(
        default="other",
        description="Coarse-grained bucket (compute, database, storage, analytics, "
        "ai_ml, network, security, observability, other). See analysis/service_taxonomy.",
    )


class AWSBillingByMonth(BaseModel):
    month: str = Field(description="YYYY-MM")
    cost: float


class AWSBillingByDay(BaseModel):
    date: str = Field(description="YYYY-MM-DD")
    cost: float


class AWSBillingResponse(BaseModel):
    account_id: Optional[str]
    period: DateRange
    total: float
    by_service: list[AWSBillingByService]
    by_month: list[AWSBillingByMonth]
    by_day: list[AWSBillingByDay] = Field(default_factory=list)
    currency: str = Field(default="USD")
    source: str = Field(
        default="cost_explorer",
        description="Origin of the data: 'cost_explorer' (real AWS CE API) or a "
        "fallback identifier.",
    )
    granularity: str = Field(default="DAILY")


class AWSService(BaseModel):
    service_id: str
    name: str
    cost_last_period: float = Field(default=0.0)


class AWSBillingQuery(BaseModel):
    """Optional query params validated up-front to prevent invalid Cost Explorer calls."""

    start: Optional[str] = Field(default=None, description="YYYY-MM-DD")
    end: Optional[str] = Field(default=None, description="YYYY-MM-DD")
    granularity: str = Field(default="DAILY")

    @field_validator("start", "end")
    @classmethod
    def _validate_date(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not _DATE_RE.match(v):
            raise ValueError(f"date must match YYYY-MM-DD, got '{v}'")
        return v

    @field_validator("granularity")
    @classmethod
    def _validate_granularity(cls, v: str) -> str:
        allowed = {"DAILY", "MONTHLY", "HOURLY"}
        if v.upper() not in allowed:
            raise ValueError(f"granularity must be one of {sorted(allowed)}, got '{v}'")
        return v.upper()

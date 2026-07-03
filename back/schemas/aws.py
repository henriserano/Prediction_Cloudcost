from __future__ import annotations

import re
from typing import Optional
from pydantic import BaseModel, Field, field_validator

from schemas.gcp import DateRange

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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

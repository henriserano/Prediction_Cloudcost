"""Portfolio schemas — grouping of cloud accounts/projects for consolidated views.

Portfolios are lightweight, user-scoped groupings persisted server-side so a
user's grouping choices follow them across browsers. Each member points to a
concrete billing scope (AWS account, GCP project, Azure subscription); the
server only stores the identifier + label, never the credentials themselves.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Provider = Literal["gcp", "aws", "azure", "local"]


# The upper bound on the number of members per portfolio is deliberately loose
# (32) — enough for a mid-size org's consolidated view, and small enough to
# keep the /billing fan-out latency bounded at read time.
_MAX_MEMBERS = 32
_MAX_NAME_LEN = 80


class PortfolioMember(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Provider
    id: Annotated[str, Field(min_length=1, max_length=200)]
    label: Annotated[str, Field(max_length=200)] | None = None


class Portfolio(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(min_length=1, max_length=64)]
    name: Annotated[str, Field(min_length=1, max_length=_MAX_NAME_LEN)]
    members: list[PortfolioMember]
    created_at: datetime
    updated_at: datetime

    @field_validator("members")
    @classmethod
    def _cap_members(cls, v: list[PortfolioMember]) -> list[PortfolioMember]:
        if len(v) > _MAX_MEMBERS:
            raise ValueError(f"A portfolio may not exceed {_MAX_MEMBERS} members.")
        # Reject duplicate (provider, id) pairs so the aggregation logic never
        # double-counts a source.
        seen: set[tuple[str, str]] = set()
        for m in v:
            key = (m.provider, m.id)
            if key in seen:
                raise ValueError(f"Duplicate member {key} in portfolio.")
            seen.add(key)
        return v


class PortfolioCreate(BaseModel):
    """Payload for POST /api/portfolios."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=_MAX_NAME_LEN)]
    members: list[PortfolioMember] = Field(default_factory=list)

    @field_validator("members")
    @classmethod
    def _cap(cls, v: list[PortfolioMember]) -> list[PortfolioMember]:
        return Portfolio._cap_members(v)


class PortfolioUpdate(BaseModel):
    """Payload for PUT /api/portfolios/{id}. Any provided field replaces the
    previous value; omitted fields are left untouched (partial update)."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=_MAX_NAME_LEN)] | None = None
    members: list[PortfolioMember] | None = None

    @field_validator("members")
    @classmethod
    def _cap(cls, v: list[PortfolioMember] | None) -> list[PortfolioMember] | None:
        if v is None:
            return None
        return Portfolio._cap_members(v)

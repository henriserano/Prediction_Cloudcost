from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


Provider = Literal["gcp", "aws"]


class CredentialUpsert(BaseModel):
    """Payload for storing (or replacing) credentials for one provider.

    The exact shape of ``payload`` is provider-specific; we only encrypt the
    JSON blob and hand it back verbatim on decrypt. The client documents its
    own schema (e.g. for GCP: refresh_token, project_id; for AWS: bearer_token
    or access_key_id/secret_access_key + optional region).
    """

    provider: Provider
    pin: str = Field(pattern=r"^\d{6}$")
    payload: dict = Field(description="Arbitrary provider-specific JSON payload.")
    label: Optional[str] = Field(
        default=None,
        max_length=120,
        description="Human-friendly label (project name, account alias).",
    )


class CredentialMetadata(BaseModel):
    """What we return to the frontend without decrypting."""

    provider: Provider
    label: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CredentialReveal(BaseModel):
    """Payload for revealing a stored credential (requires PIN)."""

    pin: str = Field(pattern=r"^\d{6}$")


class CredentialRevealResponse(BaseModel):
    provider: Provider
    payload: dict

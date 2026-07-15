from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

Provider = Literal["gcp", "aws", "azure"]

# GUID / UUID canonical form: 8-4-4-4-12 hex digits.
_GUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class AzureCredentialsPayload(BaseModel):
    """Provider-specific payload for Azure Service Principal credentials.

    Enforces GUID shape for tenant/client/subscription and length bounds on the
    client secret so the API refuses garbage before it ever reaches Azure AD.
    Extra fields are rejected to block payload smuggling (e.g. injecting a
    ``token`` key that some downstream consumer would blindly trust).
    """

    tenant_id: str = Field(min_length=36, max_length=36)
    client_id: str = Field(min_length=36, max_length=36)
    client_secret: str = Field(min_length=8, max_length=512)
    subscription_id: str | None = Field(default=None, min_length=36, max_length=36)
    location: str | None = Field(default=None, max_length=64, pattern=r"^[a-z0-9\-]+$")
    display_name: str | None = Field(default=None, max_length=200)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def _validate_guids(self) -> AzureCredentialsPayload:
        for field, value in (
            ("tenant_id", self.tenant_id),
            ("client_id", self.client_id),
            ("subscription_id", self.subscription_id),
        ):
            if value is not None and not _GUID_RE.match(value):
                raise ValueError(f"{field} must be a GUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)")
        return self


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
    label: str | None = Field(
        default=None,
        max_length=120,
        description="Human-friendly label (project name, account alias).",
    )

    @model_validator(mode="after")
    def _validate_provider_specific_payload(self) -> CredentialUpsert:
        # Azure is the only provider with a strict schema. GCP/AWS remain open
        # because their SDKs accept several shapes we don't want to codify here.
        if self.provider == "azure":
            AzureCredentialsPayload.model_validate(self.payload)
        return self


class CredentialMetadata(BaseModel):
    """What we return to the frontend without decrypting."""

    provider: Provider
    label: str | None = None
    created_at: datetime
    updated_at: datetime


class CredentialReveal(BaseModel):
    """Payload for revealing a stored credential (requires PIN)."""

    pin: str = Field(pattern=r"^\d{6}$")


class CredentialRevealResponse(BaseModel):
    provider: Provider
    payload: dict

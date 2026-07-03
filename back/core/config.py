from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
except Exception as e:  # pragma: no cover
    raise RuntimeError(
        "Missing dependency: pydantic-settings. Install with: pip install pydantic-settings"
    ) from e


class Settings(BaseSettings):
    """Application settings.

    Priority: env vars > .env file > defaults.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    app_name: str = Field(default="FinOps Analyser")
    app_version: str = Field(default="0.2.0")
    env: Literal["dev", "test", "prod"] = Field(default="dev")
    debug: bool = Field(default=False)

    # Server
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8080)

    # CORS — comma-separated origins; "*" in dev
    cors_origins: str = Field(default="*")

    # Google OAuth2
    google_client_id: str = Field(default="")
    google_client_secret: str = Field(default="")
    google_redirect_uri: str = Field(default="http://localhost:8080/api/gcp/callback")
    frontend_url: str = Field(default="http://localhost:3000")

    # GCP BigQuery Billing Export (optional). When both are set, /api/gcp/billing
    # reads real cost data from the standard billing export instead of falling
    # back to local parquet. Table default matches GCP's standard export naming.
    gcp_billing_export_project: str = Field(default="")
    gcp_billing_export_dataset: str = Field(default="")
    gcp_billing_export_table: str = Field(
        default="gcp_billing_export_v1",
        description="Prefix of the billing export table. GCP appends the billing "
        "account ID suffix automatically; set the full name if it differs.",
    )

    # AWS — boto3 uses its default credential chain (env, shared file, IAM role).
    # AWS_REGION is honored automatically by boto3 as well; expose it so the
    # backend can log which region it will hit and pass it explicitly to clients.
    aws_region: str = Field(default="eu-west-1")
    aws_cost_explorer_region: str = Field(
        default="us-east-1",
        description="Cost Explorer is a global service but its endpoint lives "
        "in us-east-1 — do not change unless AWS relocates it.",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
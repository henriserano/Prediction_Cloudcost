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

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
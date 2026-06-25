from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List, Literal

from pydantic import Field

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
except Exception as e:  # pragma: no cover
    raise RuntimeError(
        "Missing dependency: pydantic-settings. Install with: pip install pydantic-settings"
    ) from e


class Settings(BaseSettings):
    """Application settings.

    Priority:
      1) env vars
      2) .env file (if present)
      3) defaults below
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    app_name: str = Field(default="FinOps Analyser")
    app_version: str = Field(default="0.1.0")
    env: Literal["dev", "test", "prod"] = Field(default="dev")
    debug: bool = Field(default=False)

    # Server
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8080)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings accessor."""
    return Settings()
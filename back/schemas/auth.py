from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

_PIN_PATTERN = r"^\d{6}$"


class SignupRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=64)
    pin: str = Field(pattern=_PIN_PATTERN, description="6-digit numeric PIN.")

    @field_validator("display_name")
    @classmethod
    def strip_and_check(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("display_name cannot be empty")
        return v


class LoginRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=64)
    pin: str = Field(pattern=_PIN_PATTERN)

    @field_validator("display_name")
    @classmethod
    def strip_and_check(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("display_name cannot be empty")
        return v


class UserPublic(BaseModel):
    user_id: str
    display_name: str
    created_at: datetime
    has_credentials: bool = Field(description="At least one provider is stored for this user.")


class AuthResponse(BaseModel):
    user: UserPublic
    is_new: bool = Field(description="True when the signup created a fresh user record.")

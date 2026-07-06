"""Lazy DynamoDB client + table accessors.

Design:
- One boto3 resource per process (cached), so we don't reopen a TCP session
  on every request.
- Table names come from settings (populated by terraform env vars in ECS,
  or by .env locally when pointing at DynamoDB Local).
- ``ddb_endpoint_url`` lets us point at http://localhost:8000 during dev
  without any code change.

Every helper returns the raw boto3 table object; callers translate items to
the Pydantic models they expose (see routes_auth, routes_conversations,
routes_credentials).
"""
from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from core.config import get_settings
from core.errors import AppError

if TYPE_CHECKING:
    from mypy_boto3_dynamodb.service_resource import Table


@lru_cache(maxsize=1)
def _resource():
    """Return the shared boto3 DynamoDB resource. Cached for the process."""
    import boto3

    settings = get_settings()
    kwargs: dict = {"region_name": settings.aws_region}
    if settings.ddb_endpoint_url:
        # DynamoDB Local — boto3 still requires credentials, we pass dummies.
        kwargs["endpoint_url"] = settings.ddb_endpoint_url
        kwargs["aws_access_key_id"] = "dev"
        kwargs["aws_secret_access_key"] = "dev"
    return boto3.resource("dynamodb", **kwargs)


def _require_table(name: str, purpose: str) -> "Table":
    if not name:
        raise AppError(
            f"DynamoDB table for '{purpose}' is not configured. "
            f"Set DDB_TABLE_{purpose.upper()} in the environment.",
            code="CONFIGURATION_ERROR",
            status_code=500,
        )
    return _resource().Table(name)


def users_table() -> "Table":
    return _require_table(get_settings().ddb_table_users, "users")


def conversations_table() -> "Table":
    return _require_table(get_settings().ddb_table_conversations, "conversations")


def credentials_table() -> "Table":
    return _require_table(get_settings().ddb_table_credentials, "credentials")

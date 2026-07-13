"""Per-user portfolio persistence in DynamoDB.

Storage shape mirrors :mod:`core.conversations`: HASH ``user_id`` + RANGE
``portfolio_id``, with the members list serialised as a JSON string so we can
evolve the member shape without touching the schema.

All helpers swallow low-level errors and log them — a broken portfolio never
crashes the caller. Reads fall back to an empty list; writes are treated as
best-effort but surface a boolean so routes can return 500 on hard failure.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from boto3.dynamodb.conditions import Key

from core.dynamo import portfolios_table
from core.errors import AppError
from core.logging import get_logger
from schemas.portfolios import Portfolio, PortfolioMember

logger = get_logger(__name__)


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _item_to_portfolio(item: dict) -> Optional[Portfolio]:
    """Deserialise a DynamoDB item into a Portfolio, tolerating shape drift."""
    try:
        raw_members = item.get("members") or "[]"
        members_data = json.loads(raw_members) if isinstance(raw_members, str) else []
        members = [PortfolioMember(**m) for m in members_data]
        return Portfolio(
            id=str(item["portfolio_id"]),
            name=str(item.get("name") or "Portefeuille"),
            members=members,
            created_at=datetime.fromisoformat(item["created_at"]),
            updated_at=datetime.fromisoformat(item["updated_at"]),
        )
    except (KeyError, ValueError, TypeError) as exc:
        logger.warning(
            "portfolio_deserialise_failed",
            extra={"error": repr(exc), "item_keys": list(item.keys())},
        )
        return None


def list_portfolios(user_id: str) -> list[Portfolio]:
    """Return the user's portfolios, oldest first."""
    try:
        resp = portfolios_table().query(
            KeyConditionExpression=Key("user_id").eq(user_id),
        )
        out: list[Portfolio] = []
        for item in resp.get("Items", []):
            p = _item_to_portfolio(item)
            if p is not None:
                out.append(p)
        out.sort(key=lambda p: p.created_at)
        return out
    except Exception as exc:
        logger.warning(
            "portfolio_list_failed", extra={"error": repr(exc), "user_id": user_id}
        )
        return []


def get_portfolio(user_id: str, portfolio_id: str) -> Optional[Portfolio]:
    try:
        item = (
            portfolios_table()
            .get_item(Key={"user_id": user_id, "portfolio_id": portfolio_id})
            .get("Item")
        )
        if not item:
            return None
        return _item_to_portfolio(item)
    except Exception as exc:
        logger.warning(
            "portfolio_get_failed",
            extra={"error": repr(exc), "user_id": user_id, "portfolio_id": portfolio_id},
        )
        return None


def create_portfolio(
    user_id: str,
    name: str,
    members: list[PortfolioMember],
) -> Portfolio:
    """Insert a new portfolio row and return it. Raises AppError on failure."""
    now = datetime.now(tz=timezone.utc)
    portfolio = Portfolio(
        id=uuid.uuid4().hex,
        name=name,
        members=members,
        created_at=now,
        updated_at=now,
    )
    try:
        portfolios_table().put_item(
            Item={
                "user_id": user_id,
                "portfolio_id": portfolio.id,
                "name": portfolio.name,
                "members": json.dumps(
                    [m.model_dump(exclude_none=True) for m in portfolio.members],
                    ensure_ascii=False,
                ),
                "created_at": portfolio.created_at.isoformat(),
                "updated_at": portfolio.updated_at.isoformat(),
            }
        )
        return portfolio
    except Exception as exc:
        logger.error(
            "portfolio_create_failed", extra={"error": repr(exc), "user_id": user_id}
        )
        raise AppError(
            "Failed to persist portfolio.", code="INTERNAL_ERROR", status_code=500
        ) from exc


def update_portfolio(
    user_id: str,
    portfolio_id: str,
    name: Optional[str] = None,
    members: Optional[list[PortfolioMember]] = None,
) -> Optional[Portfolio]:
    """Partial update. Returns the updated portfolio, or None if not found."""
    existing = get_portfolio(user_id, portfolio_id)
    if existing is None:
        return None
    updated = existing.model_copy(
        update={
            "name": name if name is not None else existing.name,
            "members": members if members is not None else existing.members,
            "updated_at": datetime.now(tz=timezone.utc),
        }
    )
    try:
        portfolios_table().put_item(
            Item={
                "user_id": user_id,
                "portfolio_id": updated.id,
                "name": updated.name,
                "members": json.dumps(
                    [m.model_dump(exclude_none=True) for m in updated.members],
                    ensure_ascii=False,
                ),
                "created_at": updated.created_at.isoformat(),
                "updated_at": updated.updated_at.isoformat(),
            }
        )
        return updated
    except Exception as exc:
        logger.error(
            "portfolio_update_failed",
            extra={"error": repr(exc), "user_id": user_id, "portfolio_id": portfolio_id},
        )
        raise AppError(
            "Failed to update portfolio.", code="INTERNAL_ERROR", status_code=500
        ) from exc


def delete_portfolio(user_id: str, portfolio_id: str) -> bool:
    """Delete a portfolio. Returns True on success (even if it didn't exist)."""
    try:
        portfolios_table().delete_item(
            Key={"user_id": user_id, "portfolio_id": portfolio_id}
        )
        return True
    except Exception as exc:
        logger.warning(
            "portfolio_delete_failed",
            extra={"error": repr(exc), "user_id": user_id, "portfolio_id": portfolio_id},
        )
        return False

"""Per-user conversation persistence in DynamoDB.

Stored transcript is intentionally minimal — a list of
``{"role": "user"|"assistant", "content": str}`` dicts. Tool calls are
visible in the UI as chips during the live stream; we don't persist them.
The full Bedrock message shape (toolUse / toolResult blocks) is flattened
via :func:`agent.graph.extract_plain_transcript` before it reaches us.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal

from boto3.dynamodb.conditions import Key

from core.dynamo import conversations_table
from core.logging import get_logger

logger = get_logger(__name__)


_MAX_MESSAGES_STORED = 200  # keep the payload well under DynamoDB's 400KB limit


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _title_from_first_user_message(messages: list[dict]) -> str:
    for m in messages:
        if m.get("role") == "user":
            content = m.get("content") or ""
            trimmed = content.strip().splitlines()[0][:80] if content.strip() else ""
            return trimmed or "Nouvelle conversation"
    return "Nouvelle conversation"


def save_conversation(user_id: str, thread_id: str, messages: list[dict]) -> None:
    """Persist a transcript snapshot. Never raises — logs and swallows so
    persistence failures never break the chat turn.

    ``messages`` must be a list of ``{"role","content": str}`` dicts. Callers
    holding Bedrock's block format should first pass them through
    :func:`agent.graph.extract_plain_transcript`.
    """
    try:
        clean: list[dict] = []
        for m in messages:
            role = m.get("role")
            content = m.get("content")
            if role not in ("user", "assistant"):
                continue
            if not isinstance(content, str) or not content.strip():
                continue
            clean.append({"role": role, "content": content})
        if not clean:
            return
        if len(clean) > _MAX_MESSAGES_STORED:
            clean = clean[-_MAX_MESSAGES_STORED:]

        conversations_table().put_item(
            Item={
                "user_id": user_id,
                "thread_id": thread_id,
                "title": _title_from_first_user_message(clean),
                "message_count": Decimal(len(clean)),
                "messages": json.dumps(clean, ensure_ascii=False),
                "updated_at": _now_iso(),
            }
        )
    except Exception as exc:
        logger.warning(
            "conversation_save_failed",
            extra={"error": repr(exc), "user_id": user_id, "thread_id": thread_id},
        )


def load_messages(user_id: str, thread_id: str) -> list[dict]:
    """Return the persisted message dicts for a thread. Empty list on miss."""
    try:
        item = (
            conversations_table()
            .get_item(Key={"user_id": user_id, "thread_id": thread_id})
            .get("Item")
        )
        if not item:
            return []
        raw = item.get("messages") or "[]"
        return json.loads(raw)
    except Exception as exc:
        logger.warning(
            "conversation_load_failed",
            extra={"error": repr(exc), "user_id": user_id, "thread_id": thread_id},
        )
        return []


def list_conversations(user_id: str, limit: int = 50) -> list[dict]:
    """Return the user's conversations, most recent first, without messages."""
    try:
        resp = conversations_table().query(
            IndexName="user-updated-at-index",
            KeyConditionExpression=Key("user_id").eq(user_id),
            ScanIndexForward=False,
            Limit=limit,
        )
        items = resp.get("Items", [])
        return [
            {
                "thread_id": it.get("thread_id"),
                "title": it.get("title") or "Nouvelle conversation",
                "message_count": int(it.get("message_count", 0)),
                "updated_at": it.get("updated_at"),
            }
            for it in items
            if it.get("thread_id")
        ]
    except Exception as exc:
        logger.warning("conversation_list_failed", extra={"error": repr(exc), "user_id": user_id})
        return []


def delete_conversation(user_id: str, thread_id: str) -> None:
    try:
        conversations_table().delete_item(Key={"user_id": user_id, "thread_id": thread_id})
    except Exception as exc:
        logger.warning(
            "conversation_delete_failed",
            extra={"error": repr(exc), "user_id": user_id, "thread_id": thread_id},
        )

"""Per-user conversation persistence in DynamoDB.

The chat route already runs on LangGraph's MemorySaver (in-process warm
cache). This module layers a durable, per-user history on top: we snapshot
the transcript after each turn into ``finops_conversations`` and replay it
when the same thread is picked up from another process (or after a restart).

The stored ``messages`` are lightweight dicts — role + text content only,
sometimes with a truncated tool preview. We drop internal state (agent
scratchpad, tool_call ids) on purpose: the goal is UI history, not perfect
LangGraph checkpointing.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from boto3.dynamodb.conditions import Key

from core.dynamo import conversations_table
from core.logging import get_logger

logger = get_logger(__name__)


_MESSAGES_KEY = "messages"
_MAX_MESSAGES_STORED = 200  # keep the payload well under DynamoDB's 400KB limit


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _serialise_message(msg: Any) -> dict[str, Any] | None:
    """Adapt a langchain BaseMessage to a small JSON-safe dict.

    Returns None for messages we don't want to persist (empty system prompts,
    tool messages whose content is already reflected in the assistant reply).
    """
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

    if isinstance(msg, SystemMessage):
        # System prompt is re-injected server-side; no need to persist.
        return None
    if isinstance(msg, HumanMessage):
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        return {"role": "user", "content": content}
    if isinstance(msg, AIMessage):
        # AIMessage.content can be str or list of blocks. Flatten to text
        # (the tool_calls are represented separately in ChatToolCall models
        # streamed to the client; storing them again here would be redundant).
        if isinstance(msg.content, str):
            text = msg.content
        elif isinstance(msg.content, list):
            parts: list[str] = []
            for b in msg.content:
                if isinstance(b, dict) and b.get("type") == "text":
                    parts.append(str(b.get("text", "")))
            text = "".join(parts)
        else:
            text = str(msg.content)
        return {"role": "assistant", "content": text}
    if isinstance(msg, ToolMessage):
        # Tool results are visible in the UI as chips; keep only a short note.
        return None
    return None


def _title_from_first_user_message(messages: list[dict]) -> str:
    for m in messages:
        if m.get("role") == "user":
            content = m.get("content") or ""
            trimmed = content.strip().splitlines()[0][:80] if content.strip() else ""
            return trimmed or "Nouvelle conversation"
    return "Nouvelle conversation"


def save_conversation(user_id: str, thread_id: str, messages_state: list[Any]) -> None:
    """Snapshot the messages of a LangGraph state to Dynamo. Never raises —
    logs and swallows: persistence failing must not break the chat turn.
    """
    try:
        serialised: list[dict] = []
        for m in messages_state:
            item = _serialise_message(m)
            if item is not None:
                serialised.append(item)
        if not serialised:
            return
        if len(serialised) > _MAX_MESSAGES_STORED:
            # Keep the last N — older turns fall off. Beyond ~200 messages, a
            # user should start a new conversation anyway.
            serialised = serialised[-_MAX_MESSAGES_STORED:]

        conversations_table().put_item(
            Item={
                "user_id": user_id,
                "thread_id": thread_id,
                "title": _title_from_first_user_message(serialised),
                "message_count": Decimal(len(serialised)),
                "messages": json.dumps(serialised, ensure_ascii=False),
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

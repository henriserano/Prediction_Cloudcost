"""Conversation history endpoints (per authenticated user)."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from core.conversations import (
    delete_conversation,
    list_conversations,
    load_messages,
)
from core.session import require_current_user_id

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("", summary="List the current user's conversations, most recent first")
def list_(
    user_id: Annotated[str, Depends(require_current_user_id)],
    limit: int = 50,
) -> dict:
    return {"conversations": list_conversations(user_id, limit=limit)}


@router.get("/{thread_id}", summary="Full message history for one conversation")
def get_one(
    thread_id: str,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    return {
        "thread_id": thread_id,
        "messages": load_messages(user_id, thread_id),
    }


@router.delete("/{thread_id}", summary="Delete one conversation from history")
def delete(
    thread_id: str,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    delete_conversation(user_id, thread_id)
    return {"thread_id": thread_id, "deleted": True}

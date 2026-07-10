"""Conversation history endpoints (per authenticated user)."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, Response

from core.conversations import (
    delete_conversation,
    list_conversations,
    load_messages,
)
from core.pagination import apply_pagination
from core.session import require_current_user_id

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("", summary="List the current user's conversations, most recent first")
def list_(
    response: Response,
    user_id: Annotated[str, Depends(require_current_user_id)],
    limit: Annotated[Optional[int], Query(ge=1, le=200)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    """List conversations for the current user.

    Backward-compatible default: no ``limit`` returns up to 50 recent threads
    (previous behaviour). With ``limit`` set, pagination headers are added
    (X-Total-Count / X-Offset / X-Limit / X-Next-Offset).
    """
    # Cap the DDB query at the requested page (or the legacy 50-item default)
    # to avoid pulling the whole history when the caller only wants one page.
    fetch_hint = limit if limit is not None else 50
    conversations = list_conversations(user_id, limit=fetch_hint + offset)
    items = apply_pagination(conversations, response, limit=limit, offset=offset)
    return {"conversations": items}


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

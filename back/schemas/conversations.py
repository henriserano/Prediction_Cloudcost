"""Response schemas for /api/conversations."""

from __future__ import annotations

from pydantic import BaseModel


class ConversationSummary(BaseModel):
    thread_id: str
    title: str
    message_count: int
    updated_at: str | None = None


class ConversationListResponse(BaseModel):
    conversations: list[ConversationSummary]


class ConversationMessage(BaseModel):
    role: str
    content: str


class ConversationDetailResponse(BaseModel):
    thread_id: str
    messages: list[ConversationMessage]


class ConversationDeleteResponse(BaseModel):
    thread_id: str
    deleted: bool

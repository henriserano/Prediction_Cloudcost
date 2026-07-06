from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000, description="User prompt")
    thread_id: Optional[str] = Field(
        default=None,
        description="Optional conversation identifier. When provided, prior turns "
        "for the same thread are replayed as context. Server generates one when omitted.",
    )
    system_prompt: Optional[str] = Field(
        default=None,
        max_length=4000,
        description="Override the default system prompt (advanced use).",
    )


class ChatToolCall(BaseModel):
    """One tool invocation performed by the agent, echoed back to the client."""

    name: str
    arguments: dict[str, Any]
    result_preview: str = Field(
        description="First ~600 chars of the tool's stringified result. Full "
        "results are not returned to avoid blowing up the payload."
    )


class ChatResponse(BaseModel):
    thread_id: str
    reply: str
    tool_calls: list[ChatToolCall] = Field(default_factory=list)
    model: str
    total_tokens: Optional[int] = None

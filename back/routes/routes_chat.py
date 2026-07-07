"""Chat endpoints — thin adapters over :mod:`agent.graph`.

The heavy lifting (Bedrock Converse, tool-use loop, streaming) lives in
``agent.graph``. This module only:

- authenticates the caller and looks up the persisted transcript for the
  thread, if any (``core.conversations.load_messages``);
- shapes the graph events into Server-Sent Events for the streaming path;
- writes the final transcript back to DynamoDB so a new process picks up
  the same conversation on cold start.
"""
from __future__ import annotations

import json
import uuid
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from agent.graph import (
    DEFAULT_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    extract_plain_transcript,
    invoke_chat,
    stream_chat,
)
from core.auth import require_api_key
from core.config import get_settings
from core.conversations import (
    delete_conversation,
    load_messages,
    save_conversation,
)
from core.errors import AppError
from core.logging import get_logger
from core.session import get_current_user_id
from schemas.chat import ChatRequest, ChatResponse, ChatToolCall

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])


def _sse(event: str, payload: dict) -> bytes:
    """Format a Server-Sent Event frame. Single-line JSON keeps parsing trivial."""
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def _seed_messages(user_id: str | None, thread_id: str, user_message: str) -> list[dict]:
    """Build the message list handed to the agent.

    Replays the persisted transcript from Dynamo (if any) so the model has
    context on cold-start processes, then appends the new user turn.
    """
    messages: list[dict] = []
    if user_id and get_settings().auth_enabled:
        for m in load_messages(user_id, thread_id):
            content = m.get("content") or ""
            if content:
                messages.append({"role": m["role"], "content": content})
    messages.append({"role": "user", "content": user_message})
    return messages


# ---------------------------------------------------------------------------
# Sync chat — one turn, one JSON payload
# ---------------------------------------------------------------------------

@router.post(
    "/chat",
    response_model=ChatResponse,
    dependencies=[Depends(require_api_key)],
    summary="Chat with the FinOps agent backed by Bedrock",
)
def chat(request: Request, body: ChatRequest) -> ChatResponse:
    """Run one turn end-to-end and return the reply as a single JSON payload.

    - ``thread_id`` continues an existing conversation; omit it to start fresh.
    - System prompt is server-controlled (``DEFAULT_SYSTEM_PROMPT``) — no
      client override.
    - Tool calls are echoed back so the UI can render chips.
    """
    thread_id = body.thread_id or uuid.uuid4().hex
    user_id = get_current_user_id(request)
    messages = _seed_messages(user_id, thread_id, body.message)

    try:
        result = invoke_chat(messages, system_prompt=DEFAULT_SYSTEM_PROMPT, model_id=DEFAULT_MODEL)
    except AppError:
        raise
    except Exception as exc:
        logger.error(
            "chat_invoke_failed",
            extra={"error": repr(exc), "thread_id": thread_id},
            exc_info=True,
        )
        raise AppError(
            f"Agent invocation failed: {exc.__class__.__name__}: {exc}",
            code="AGENT_ERROR",
            status_code=502,
            details={"thread_id": thread_id},
        )

    if user_id and get_settings().auth_enabled:
        save_conversation(user_id, thread_id, extract_plain_transcript(result.messages))

    return ChatResponse(
        thread_id=thread_id,
        reply=result.reply,
        tool_calls=[
            ChatToolCall(
                name=tc.name,
                arguments=tc.arguments,
                result_preview=tc.result_preview,
            )
            for tc in result.tool_calls
        ],
        model=result.model,
        total_tokens=result.total_tokens,
    )


# ---------------------------------------------------------------------------
# Streaming chat — SSE
# ---------------------------------------------------------------------------

@router.post(
    "/chat/stream",
    dependencies=[Depends(require_api_key)],
    summary="Stream a chat turn as Server-Sent Events",
)
async def chat_stream(request: Request, body: ChatRequest) -> StreamingResponse:
    """Stream the agent turn as SSE.

    Event types (each frame ``event: TYPE\\ndata: JSON\\n\\n``):

    - ``ready``       → ``{ thread_id }``. Emitted first so the client can
      persist the thread id even if the stream is aborted mid-way.
    - ``token``       → ``{ text }``. Incremental text delta.
    - ``tool_start``  → ``{ id, name, arguments }``. Agent is invoking a tool.
    - ``tool_end``    → ``{ id, result_preview }``. Tool returned (preview
      capped at ~600 chars).
    - ``done``        → ``{ thread_id, model, total_tokens }``. Stream complete.
    - ``error``       → ``{ message, code? }``. Fatal error during generation.

    Setup / Bedrock errors are surfaced as an ``error`` event on a 200 stream
    rather than a raw 500, so the chatbot UI can render the reason inline.
    """
    thread_id = body.thread_id or uuid.uuid4().hex
    user_id = get_current_user_id(request)

    async def event_source() -> AsyncIterator[bytes]:
        yield _sse("ready", {"thread_id": thread_id})

        messages = _seed_messages(user_id, thread_id, body.message)
        total_tokens: int | None = None
        final_messages: list[dict] = messages

        try:
            async for ev in stream_chat(
                messages,
                system_prompt=DEFAULT_SYSTEM_PROMPT,
                model_id=DEFAULT_MODEL,
            ):
                kind = ev["type"]
                if kind == "token":
                    yield _sse("token", {"text": ev["text"]})
                elif kind == "tool_start":
                    yield _sse("tool_start", {
                        "id": ev["id"],
                        "name": ev["name"],
                        "arguments": ev.get("arguments") or {},
                    })
                elif kind == "tool_end":
                    yield _sse("tool_end", {
                        "id": ev["id"],
                        "result_preview": ev.get("result_preview", ""),
                    })
                elif kind == "done":
                    total_tokens = ev.get("total_tokens")
                    final_messages = ev.get("messages", messages)
        except AppError as exc:
            yield _sse("error", {"message": exc.message, "code": exc.code})
            return
        except Exception as exc:
            logger.error(
                "chat_stream_failed",
                extra={"error": repr(exc), "thread_id": thread_id},
                exc_info=True,
            )
            detail = str(exc)
            if len(detail) > 300:
                detail = detail[:300] + "..."
            msg = f"Agent stream failed: {exc.__class__.__name__}"
            if detail and detail != exc.__class__.__name__:
                msg += f" — {detail}"
            yield _sse("error", {"message": msg, "code": "AGENT_ERROR"})
            return

        # Persist the flattened transcript. Never raises — save_conversation
        # logs and swallows so a Dynamo hiccup doesn't break the response.
        if user_id and get_settings().auth_enabled:
            save_conversation(
                user_id, thread_id, extract_plain_transcript(final_messages)
            )

        yield _sse("done", {
            "thread_id": thread_id,
            "model": DEFAULT_MODEL,
            "total_tokens": total_tokens,
        })

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------------------------------------------------------------------------
# Reset — wipe the persisted transcript for a thread
# ---------------------------------------------------------------------------

@router.delete(
    "/chat/{thread_id}",
    dependencies=[Depends(require_api_key)],
    summary="Reset a conversation thread",
)
def reset_chat(thread_id: Annotated[str, ...], request: Request) -> dict:
    """Delete the persisted transcript for this thread. The next turn will
    start with an empty history."""
    user_id = get_current_user_id(request)
    if user_id and get_settings().auth_enabled:
        delete_conversation(user_id, thread_id)
    return {"thread_id": thread_id, "reset": True}

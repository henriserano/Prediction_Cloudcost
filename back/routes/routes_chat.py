from __future__ import annotations

import json
import uuid
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from agent.graph import DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, get_agent
from core.auth import require_api_key
from core.errors import AppError
from core.logging import get_logger
from schemas.chat import ChatRequest, ChatResponse, ChatToolCall

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])


_TOOL_RESULT_PREVIEW_CHARS = 600


def _sse(event: str, payload: dict) -> bytes:
    """Format a Server-Sent Event frame. Single-line JSON keeps parsing trivial."""
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


@router.post(
    "/chat",
    response_model=ChatResponse,
    dependencies=[Depends(require_api_key)],
    summary="Chat with the FinOps agent backed by Bedrock + LangGraph",
)
def chat(body: ChatRequest) -> ChatResponse:
    """Run one turn through the LangGraph agent.

    - ``thread_id`` continues an existing conversation; omit it to start fresh.
    - ``system_prompt`` overrides the default analyst persona for the whole
      thread (kept in the checkpointed state).
    - Every tool the agent invoked is echoed back in ``tool_calls`` with a
      short preview so the frontend can render "the agent looked at X" chips.

    Requires ``AWS_BEARER_TOKEN_BEDROCK`` (or standard AWS credentials) in the
    server process. See :func:`agent.graph.get_agent` for details.
    """
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

    agent = get_agent(DEFAULT_MODEL)
    thread_id = body.thread_id or uuid.uuid4().hex
    config = {"configurable": {"thread_id": thread_id}}

    # Seed the system message on the first turn only. LangGraph's MemorySaver
    # already keeps prior turns; passing the system prompt every call would
    # duplicate it in the transcript.
    try:
        existing = agent.get_state(config).values.get("messages", [])
    except Exception:
        existing = []

    messages: list = []
    if not existing:
        messages.append(SystemMessage(content=body.system_prompt or DEFAULT_SYSTEM_PROMPT))
    messages.append(HumanMessage(content=body.message))

    try:
        result = agent.invoke({"messages": messages}, config=config)
    except AppError:
        raise
    except Exception as exc:
        logger.error("chat_invoke_failed", extra={"error": repr(exc), "thread_id": thread_id})
        raise AppError(
            f"Agent invocation failed: {exc.__class__.__name__}",
            code="AGENT_ERROR",
            status_code=502,
            details={"thread_id": thread_id},
        )

    final = result["messages"][-1]
    reply = final.content if isinstance(final.content, str) else str(final.content)

    # Reconstruct the ordered tool_calls list from the turn's new messages so
    # the frontend can display "used tool X → preview Y" chips.
    tool_calls: list[ChatToolCall] = []
    new_slice = result["messages"][len(existing):]
    pending: dict[str, ChatToolCall] = {}
    for msg in new_slice:
        if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
            for tc in msg.tool_calls:
                pending[tc["id"]] = ChatToolCall(
                    name=tc["name"],
                    arguments=dict(tc.get("args") or {}),
                    result_preview="",
                )
        elif isinstance(msg, ToolMessage):
            call = pending.get(msg.tool_call_id)
            if call is not None:
                preview = str(msg.content or "")
                if len(preview) > _TOOL_RESULT_PREVIEW_CHARS:
                    preview = preview[:_TOOL_RESULT_PREVIEW_CHARS] + "..."
                call.result_preview = preview
                tool_calls.append(call)

    usage_metadata = getattr(final, "usage_metadata", None) or {}
    total_tokens = usage_metadata.get("total_tokens") if isinstance(usage_metadata, dict) else None

    return ChatResponse(
        thread_id=thread_id,
        reply=reply,
        tool_calls=tool_calls,
        model=DEFAULT_MODEL,
        total_tokens=total_tokens,
    )


@router.post(
    "/chat/stream",
    dependencies=[Depends(require_api_key)],
    summary="Stream a chat turn as Server-Sent Events",
)
async def chat_stream(body: ChatRequest) -> StreamingResponse:
    """Stream the agent turn as SSE.

    Event types emitted (each ``event: TYPE\\ndata: JSON\\n\\n``):

    - ``ready``       → ``{ thread_id }``. Sent first so the client can persist
      the thread id even if the stream is aborted mid-way.
    - ``token``       → ``{ text }``. Incremental text delta from the LLM.
    - ``tool_start``  → ``{ id, name, arguments }``. Agent invoked a tool.
    - ``tool_end``    → ``{ id, result_preview }``. Tool returned (preview
      capped at ~600 chars).
    - ``done``        → ``{ thread_id, model, total_tokens }``. Stream complete.
    - ``error``       → ``{ message, code? }``. Fatal error during generation.

    Setup failures (agent build, Bedrock config) are turned into an ``error``
    event on a 200 stream rather than a raw 500, so the chatbot UI can render
    the human-readable reason in the current message bubble.
    """
    from langchain_core.messages import HumanMessage, SystemMessage

    thread_id = body.thread_id or uuid.uuid4().hex

    # Try to build the agent up-front so we can surface setup failures inline.
    try:
        agent = get_agent(DEFAULT_MODEL)
        config = {"configurable": {"thread_id": thread_id}}
        try:
            existing = agent.get_state(config).values.get("messages", [])
        except Exception:
            existing = []

        messages: list = []
        if not existing:
            messages.append(
                SystemMessage(content=body.system_prompt or DEFAULT_SYSTEM_PROMPT)
            )
        messages.append(HumanMessage(content=body.message))
        setup_error: tuple[str, str] | None = None
    except AppError as exc:
        agent = None
        config = None
        messages = []
        setup_error = (exc.message, exc.code)
    except Exception as exc:
        logger.error("chat_stream_setup_failed", extra={"error": repr(exc)}, exc_info=True)
        agent = None
        config = None
        messages = []
        setup_error = (
            f"Agent setup failed: {exc.__class__.__name__}: {exc}",
            "AGENT_ERROR",
        )

    async def event_source() -> AsyncIterator[bytes]:
        yield _sse("ready", {"thread_id": thread_id})

        if setup_error is not None:
            msg, code = setup_error
            yield _sse("error", {"message": msg, "code": code})
            return

        assert agent is not None and config is not None
        total_tokens: int | None = None
        try:
            async for ev in agent.astream_events(
                {"messages": messages}, config=config, version="v2"
            ):
                kind = ev.get("event")
                if kind == "on_chat_model_stream":
                    chunk = ev.get("data", {}).get("chunk")
                    if chunk is None:
                        continue
                    content = getattr(chunk, "content", "")
                    # Bedrock chunks: content may be a plain string OR a list of
                    # block dicts ([{"type":"text","text":"..."}, {"type":"tool_use",...}]).
                    if isinstance(content, str):
                        if content:
                            yield _sse("token", {"text": content})
                    elif isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                text = block.get("text", "")
                                if text:
                                    yield _sse("token", {"text": text})
                    um = getattr(chunk, "usage_metadata", None)
                    if isinstance(um, dict) and um.get("total_tokens"):
                        total_tokens = um["total_tokens"]

                elif kind == "on_tool_start":
                    yield _sse(
                        "tool_start",
                        {
                            "id": ev.get("run_id", ""),
                            "name": ev.get("name", ""),
                            "arguments": ev.get("data", {}).get("input", {}) or {},
                        },
                    )

                elif kind == "on_tool_end":
                    output = ev.get("data", {}).get("output")
                    if hasattr(output, "content"):
                        preview = str(output.content)
                    elif output is None:
                        preview = ""
                    else:
                        preview = str(output)
                    if len(preview) > _TOOL_RESULT_PREVIEW_CHARS:
                        preview = preview[:_TOOL_RESULT_PREVIEW_CHARS] + "..."
                    yield _sse(
                        "tool_end",
                        {"id": ev.get("run_id", ""), "result_preview": preview},
                    )

            yield _sse(
                "done",
                {"thread_id": thread_id, "model": DEFAULT_MODEL, "total_tokens": total_tokens},
            )
        except AppError as exc:
            yield _sse("error", {"message": exc.message, "code": exc.code})
        except Exception as exc:
            logger.error(
                "chat_stream_failed",
                extra={"error": repr(exc), "thread_id": thread_id},
                exc_info=True,
            )
            # Surface exception detail (AWS message, HTTP body, etc.) so the
            # chat UI can show something actionable instead of just the class
            # name. Bounded to 300 chars to avoid dumping huge payloads.
            detail = str(exc)
            if len(detail) > 300:
                detail = detail[:300] + "..."
            message = f"Agent stream failed: {exc.__class__.__name__}"
            if detail and detail != exc.__class__.__name__:
                message += f" — {detail}"
            yield _sse("error", {"message": message, "code": "AGENT_ERROR"})

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.delete(
    "/chat/{thread_id}",
    dependencies=[Depends(require_api_key)],
    summary="Reset a conversation thread",
)
def reset_chat(thread_id: Annotated[str, ...]) -> dict:
    """Delete every checkpoint for a thread so the next turn starts fresh.

    Useful when the user wants to change topic or drop stale context from the
    agent's memory without spinning up a new thread on the client side.
    """
    agent = get_agent(DEFAULT_MODEL)
    config = {"configurable": {"thread_id": thread_id}}
    try:
        agent.update_state(config, {"messages": []})
    except Exception as exc:
        logger.warning("chat_reset_failed", extra={"error": repr(exc), "thread_id": thread_id})
    return {"thread_id": thread_id, "reset": True}

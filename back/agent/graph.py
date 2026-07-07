"""FinOps chat agent — pure boto3 Bedrock Converse client.

Design choices:

- No LangChain, no LangGraph. Bedrock's Converse / ConverseStream APIs are
  called directly. The tool-use loop is explicit (see ``stream_chat``) so
  every hop is visible and debuggable.
- Stateless module. Callers pass the full message history at every turn;
  persistence (Dynamo) lives in ``routes_chat`` + ``core.conversations``.
- Auth relies on boto3's default credential chain (task role on Fargate,
  ``AWS_BEARER_TOKEN_BEDROCK`` or ``AWS_PROFILE`` locally). No secret is
  handled here.
- Tools come from the shared registry (``agent.registry``), so ``/api/tools``,
  ``/api/chat`` and any future MCP client expose the same set.

Bedrock message shape (``content`` is always a list of blocks):

    { "role": "user"|"assistant",
      "content": [
        { "text": "..." }
        | { "toolUse":   { "toolUseId","name","input" } }
        | { "toolResult":{ "toolUseId","content":[{"text":"..."}] } }
      ] }

Callers may hand us simplified ``{"role","content": str}`` messages; we
normalise them via :func:`_normalise_message`.
"""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, AsyncIterator, Iterable

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from agent import registry
# Importing agent.tools has the side effect of running every @register
# decorator in that module, populating the shared tool registry. Without
# this line, ``_tool_config()`` would return an empty list on cold start
# and Bedrock's Converse call would reject the request with
# ``Invalid length for parameter toolConfig.tools, value: 0``.
import agent.tools  # noqa: F401
from core.errors import AppError
from core.logging import get_logger

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Public config knobs
# ---------------------------------------------------------------------------

DEFAULT_SYSTEM_PROMPT = (
    "You are a senior FinOps analyst embedded in a cost-analysis dashboard. "
    "You have tools that expose the current dataset (KPIs, per-service "
    "breakdown, forecasts, outliers, drift diagnostics, distribution tests, "
    "missingness, PCA). Always call the relevant tool before quoting numbers "
    "— never invent figures. If the user asks a broad question, prefer "
    "starting with `get_data_status` + `get_kpi_snapshot` to ground the "
    "conversation. Reply in the user's language, be concise, cite the tool "
    "you used to obtain each number, and flag any uncertainty (e.g. "
    "'source: parquet_fallback — this is demo data, not live GCP')."
)

DEFAULT_MODEL = os.getenv("BEDROCK_MODEL_ID", "eu.anthropic.claude-sonnet-4-6")

_TOOL_RESULT_PREVIEW_CHARS = 600
_MAX_TOOL_ITERATIONS = 6


# ---------------------------------------------------------------------------
# Public result types
# ---------------------------------------------------------------------------

@dataclass
class ToolCallTrace:
    id: str
    name: str
    arguments: dict[str, Any]
    result_preview: str


@dataclass
class ChatResult:
    reply: str
    tool_calls: list[ToolCallTrace] = field(default_factory=list)
    model: str = DEFAULT_MODEL
    total_tokens: int | None = None
    messages: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Bedrock client + credential check
# ---------------------------------------------------------------------------

def _region() -> str:
    return os.getenv("BEDROCK_REGION") or os.getenv("AWS_REGION", "eu-west-1")


@lru_cache(maxsize=1)
def _client():
    """Cached bedrock-runtime client (avoid opening a new TCP session per turn)."""
    return boto3.client("bedrock-runtime", region_name=_region())


def _ensure_credentials() -> None:
    """Fail fast with a helpful message when no boto3 creds are available."""
    for var in (
        "AWS_BEARER_TOKEN_BEDROCK",
        "AWS_ACCESS_KEY_ID",
        "AWS_PROFILE",
        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    ):
        if os.getenv(var):
            return
    raise AppError(
        "Bedrock is not configured: no AWS credentials in the environment. "
        "Expected AWS_BEARER_TOKEN_BEDROCK, standard AWS credentials, or an "
        "ECS/EKS task role.",
        code="CONFIGURATION_ERROR",
        status_code=500,
    )


# ---------------------------------------------------------------------------
# Converse request builders
# ---------------------------------------------------------------------------

def _tool_config() -> dict:
    """Bedrock ``toolConfig`` payload derived from the shared tool registry."""
    specs = registry.list_specs()
    if not specs:
        # Bedrock rejects an empty tools list with a cryptic
        # ParamValidationError. Fail loudly here so the operator knows the
        # side-effectful ``import agent.tools`` didn't run (module missing,
        # cache issue, misordered imports).
        raise AppError(
            "No tools registered. Check that ``agent.tools`` is importable "
            "and that its @register decorators executed at module load.",
            code="CONFIGURATION_ERROR",
            status_code=500,
        )
    return {
        "tools": [
            {
                "toolSpec": {
                    "name": spec.name,
                    "description": spec.description,
                    "inputSchema": {"json": spec.input_schema},
                }
            }
            for spec in specs
        ]
    }


def _inference_config() -> dict:
    try:
        max_tokens = int(os.getenv("BEDROCK_MAX_TOKENS", "2048"))
    except ValueError:
        max_tokens = 2048
    return {"maxTokens": max_tokens, "temperature": 0.1}


def _guardrail_config() -> dict | None:
    gid = os.getenv("BEDROCK_GUARDRAIL_ID", "").strip()
    if not gid:
        return None
    return {
        "guardrailIdentifier": gid,
        "guardrailVersion": os.getenv("BEDROCK_GUARDRAIL_VERSION", "DRAFT"),
    }


def _normalise_message(m: dict) -> dict:
    """Turn a ``{role, content: str}`` message into Bedrock's block format.

    Messages already in Bedrock format (``content`` is a list) are returned
    as-is. Empty content strings are collapsed into a single space so Bedrock
    doesn't refuse the payload.
    """
    role = m.get("role")
    content = m.get("content")
    if isinstance(content, list):
        return {"role": role, "content": content}
    text = str(content or "").strip() or " "
    return {"role": role, "content": [{"text": text}]}


def _converse_kwargs(model_id: str, system_prompt: str, messages: list[dict]) -> dict:
    kwargs: dict = {
        "modelId": model_id,
        "system": [{"text": system_prompt}],
        "messages": [_normalise_message(m) for m in messages],
        "inferenceConfig": _inference_config(),
        "toolConfig": _tool_config(),
    }
    guardrail = _guardrail_config()
    if guardrail:
        kwargs["guardrailConfig"] = guardrail
    return kwargs


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

def _execute_tool(name: str, arguments: dict) -> tuple[str, str]:
    """Run a registered tool. Return ``(full_text, preview_text)``.

    Any exception is caught and returned as an inline JSON error string. The
    LLM sees the error verbatim and can decide to retry with different args
    or bail out — we never crash the conversation on a tool failure.
    """
    try:
        text = registry.execute(name, arguments)
    except KeyError:
        text = json.dumps({"error": f"Unknown tool: {name}"})
    except Exception as exc:  # noqa: BLE001 — deliberate broad catch
        logger.warning(
            "tool_execute_failed",
            extra={"tool": name, "error": repr(exc)},
        )
        text = json.dumps({"error": f"{exc.__class__.__name__}: {exc}"})
    preview = (
        text if len(text) <= _TOOL_RESULT_PREVIEW_CHARS
        else text[:_TOOL_RESULT_PREVIEW_CHARS] + "..."
    )
    return text, preview


# ---------------------------------------------------------------------------
# Error mapping
# ---------------------------------------------------------------------------

def _wrap_bedrock_error(exc: Exception) -> AppError:
    """Convert a botocore exception into a user-friendly AppError."""
    if isinstance(exc, ClientError):
        err = exc.response.get("Error", {})
        code = err.get("Code", "BedrockError")
        message = err.get("Message", str(exc))
        return AppError(
            f"Bedrock {code}: {message}",
            code="AGENT_ERROR",
            status_code=502,
        )
    return AppError(
        f"Bedrock call failed: {exc.__class__.__name__}: {exc}",
        code="AGENT_ERROR",
        status_code=502,
    )


# ---------------------------------------------------------------------------
# Streaming — parse Bedrock event stream into normalised events
# ---------------------------------------------------------------------------

async def stream_chat(
    messages: list[dict],
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    model_id: str = DEFAULT_MODEL,
) -> AsyncIterator[dict]:
    """Run one chat turn end-to-end and yield events as they happen.

    Events (single-key ``type`` discriminator):

    - ``{"type": "token",      "text": str}``
    - ``{"type": "tool_start", "id","name","arguments"}``
    - ``{"type": "tool_end",   "id","result_preview"}``
    - ``{"type": "done",       "total_tokens","messages"}`` (final)

    ``messages`` in the final ``done`` event is the full transcript including
    every assistant reply, toolUse and toolResult block — hand it to
    ``core.conversations.save_conversation`` (via
    :func:`extract_plain_transcript`) for persistence.
    """
    _ensure_credentials()
    client = _client()
    working: list[dict] = [_normalise_message(m) for m in messages]
    total_tokens: int | None = None
    hit_max_iterations = True  # cleared by the ``break`` below

    for _iteration in range(_MAX_TOOL_ITERATIONS):
        # ConverseStream is a sync call; hop to a thread so the initial
        # handshake doesn't block the event loop.
        try:
            response = await asyncio.to_thread(
                client.converse_stream,
                **_converse_kwargs(model_id, system_prompt, working),
            )
        except (ClientError, BotoCoreError) as exc:
            raise _wrap_bedrock_error(exc)

        # Parse the event stream inline. Each chunk read from
        # ``response["stream"]`` blocks briefly on the network; that's fine
        # inside an SSE StreamingResponse — the FastAPI loop schedules
        # around us.
        text_by_idx: dict[int, str] = {}
        tool_by_idx: dict[int, dict] = {}
        stop_reason = "end_turn"

        for event in response["stream"]:
            if "contentBlockStart" in event:
                blk = event["contentBlockStart"]
                idx = blk.get("contentBlockIndex", 0)
                start = blk.get("start", {})
                if "toolUse" in start:
                    tu = start["toolUse"]
                    tool_by_idx[idx] = {
                        "id": tu["toolUseId"],
                        "name": tu["name"],
                        "input_fragments": [],
                    }

            elif "contentBlockDelta" in event:
                blk = event["contentBlockDelta"]
                idx = blk.get("contentBlockIndex", 0)
                delta = blk["delta"]
                if "text" in delta:
                    text_by_idx[idx] = text_by_idx.get(idx, "") + delta["text"]
                    yield {"type": "token", "text": delta["text"]}
                elif "toolUse" in delta and idx in tool_by_idx:
                    tool_by_idx[idx]["input_fragments"].append(
                        delta["toolUse"].get("input", "")
                    )

            elif "messageStop" in event:
                stop_reason = event["messageStop"].get("stopReason", "end_turn")

            elif "metadata" in event:
                usage = event["metadata"].get("usage") or {}
                tokens = usage.get("totalTokens")
                if tokens:
                    total_tokens = (total_tokens or 0) + int(tokens)

        # Rebuild the assistant message in the original block order.
        assistant_content: list[dict] = []
        max_idx = max([-1, *text_by_idx.keys(), *tool_by_idx.keys()])
        parsed_tools: list[dict] = []  # ordered: {"id","name","arguments"}
        for i in range(max_idx + 1):
            if i in tool_by_idx:
                tc = tool_by_idx[i]
                raw = "".join(tc["input_fragments"])
                try:
                    args = json.loads(raw) if raw else {}
                except json.JSONDecodeError:
                    args = {}
                assistant_content.append({
                    "toolUse": {
                        "toolUseId": tc["id"],
                        "name": tc["name"],
                        "input": args,
                    }
                })
                parsed_tools.append({
                    "id": tc["id"], "name": tc["name"], "arguments": args
                })
            elif i in text_by_idx and text_by_idx[i]:
                assistant_content.append({"text": text_by_idx[i]})

        working.append({"role": "assistant", "content": assistant_content})

        # No tool calls (or model signalled final answer) → we're done.
        if stop_reason != "tool_use" or not parsed_tools:
            hit_max_iterations = False
            break

        # Execute tools sequentially and stream tool_start / tool_end events.
        tool_results: list[dict] = []
        for tc in parsed_tools:
            yield {
                "type": "tool_start",
                "id": tc["id"],
                "name": tc["name"],
                "arguments": tc["arguments"],
            }
            full_text, preview = await asyncio.to_thread(
                _execute_tool, tc["name"], tc["arguments"]
            )
            yield {
                "type": "tool_end",
                "id": tc["id"],
                "result_preview": preview,
            }
            tool_results.append({
                "toolResult": {
                    "toolUseId": tc["id"],
                    "content": [{"text": full_text}],
                }
            })

        working.append({"role": "user", "content": tool_results})

    if hit_max_iterations:
        logger.warning(
            "chat_max_iterations_reached",
            extra={"max_iterations": _MAX_TOOL_ITERATIONS},
        )

    yield {
        "type": "done",
        "total_tokens": total_tokens,
        "messages": working,
    }


# ---------------------------------------------------------------------------
# Sync variant — thin wrapper around the streaming path
# ---------------------------------------------------------------------------

def invoke_chat(
    messages: list[dict],
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    model_id: str = DEFAULT_MODEL,
) -> ChatResult:
    """Blocking convenience wrapper: run the whole turn and return the reply.

    Uses ``stream_chat`` under the hood so the streaming and non-streaming
    endpoints share exactly one code path.
    """
    reply_parts: list[str] = []
    tool_calls: list[ToolCallTrace] = []
    current_start: dict | None = None
    total_tokens: int | None = None
    final_messages: list[dict] = messages

    async def _drain() -> None:
        nonlocal current_start, total_tokens, final_messages
        async for ev in stream_chat(messages, system_prompt, model_id):
            kind = ev["type"]
            if kind == "token":
                reply_parts.append(ev["text"])
            elif kind == "tool_start":
                current_start = ev
            elif kind == "tool_end":
                if current_start:
                    tool_calls.append(ToolCallTrace(
                        id=current_start["id"],
                        name=current_start["name"],
                        arguments=current_start["arguments"],
                        result_preview=ev["result_preview"],
                    ))
                    current_start = None
            elif kind == "done":
                total_tokens = ev.get("total_tokens")
                final_messages = ev.get("messages", messages)

    asyncio.run(_drain())
    return ChatResult(
        reply="".join(reply_parts),
        tool_calls=tool_calls,
        model=model_id,
        total_tokens=total_tokens,
        messages=final_messages,
    )


# ---------------------------------------------------------------------------
# Utilities exposed for routes_chat / conversations persistence
# ---------------------------------------------------------------------------

def extract_plain_transcript(messages: Iterable[dict]) -> list[dict]:
    """Flatten Bedrock-format messages into ``[{role, content: str}, ...]``.

    Text is joined across content blocks; toolUse and toolResult blocks are
    dropped — the user-visible transcript is what we persist. Used by
    ``routes_chat`` to hand off to ``core.conversations.save_conversation``.
    """
    out: list[dict] = []
    for m in messages:
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        content = m.get("content")
        if isinstance(content, str):
            if content.strip():
                out.append({"role": role, "content": content})
            continue
        if not isinstance(content, list):
            continue
        text_parts = [
            str(b.get("text", ""))
            for b in content
            if isinstance(b, dict) and "text" in b
        ]
        joined = "".join(text_parts).strip()
        if joined:
            out.append({"role": role, "content": joined})
    return out

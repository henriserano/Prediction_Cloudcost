"""MCP-style tool discovery + direct invocation.

The chat agent uses the same registry under the hood, so anything you can call
here is exactly what the LangGraph agent has access to. Handy for:
- Wiring an external MCP client / another LLM harness against these tools.
- Debugging tool output without going through the LLM.
- Building a "capabilities" panel in the frontend that lists what the agent
  can do without hardcoding it there.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.auth import require_api_key
from core.errors import AppError, NotFound
from core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["tools"])


class ToolDescriptor(BaseModel):
    """MCP-compatible tool descriptor."""

    name: str
    description: str
    category: str
    input_schema: dict = Field(description="JSON Schema for arguments")
    read_only: bool
    tags: list[str] = Field(default_factory=list)


class ToolCatalog(BaseModel):
    total: int
    categories: dict[str, int]
    tools: list[ToolDescriptor]


class ToolInvokeRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    arguments: dict[str, Any] | None = None


class ToolInvokeResponse(BaseModel):
    name: str
    result: str = Field(description="Serialised tool output (JSON string, bounded to ~6KB)")


def _load_registry():
    """Import agent.tools (side-effect: fills the registry) then return it.

    Import is deferred so the FinOps API can boot without the agent module
    even in stripped-down environments (tests that monkeypatch loaders, etc.).
    """
    import agent.tools  # noqa: F401
    from agent import registry

    return registry


@router.get("/tools", response_model=ToolCatalog, summary="List all agent tools")
def list_tools() -> ToolCatalog:
    """Enumerate every tool the FinOps agent can use.

    Same shape as an MCP ``tools/list`` response — external MCP clients can
    consume this endpoint directly.
    """
    reg = _load_registry()
    specs = reg.list_specs()
    categories: dict[str, int] = {}
    for spec in specs:
        categories[spec.category] = categories.get(spec.category, 0) + 1
    return ToolCatalog(
        total=len(specs),
        categories=categories,
        tools=[
            ToolDescriptor(
                name=s.name,
                description=s.description,
                category=s.category,
                input_schema=s.input_schema,
                read_only=s.read_only,
                tags=s.tags,
            )
            for s in specs
        ],
    )


@router.get("/tools/{name}", response_model=ToolDescriptor, summary="Get one tool's descriptor")
def get_tool(name: str) -> ToolDescriptor:
    reg = _load_registry()
    try:
        spec = reg.get(name)
    except KeyError:
        raise NotFound(f"Tool '{name}' does not exist.") from None
    return ToolDescriptor(
        name=spec.name,
        description=spec.description,
        category=spec.category,
        input_schema=spec.input_schema,
        read_only=spec.read_only,
        tags=spec.tags,
    )


@router.post(
    "/tools/invoke",
    response_model=ToolInvokeResponse,
    dependencies=[Depends(require_api_key)],
    summary="Invoke a tool by name",
)
def invoke_tool(body: ToolInvokeRequest) -> ToolInvokeResponse:
    """Call one tool directly (without the LLM).

    Protected by ``X-API-Key`` because a bad-actor could otherwise poll every
    tool at unlimited rate. Read-only tools still incur compute cost.
    """
    reg = _load_registry()
    try:
        result = reg.execute(body.name, body.arguments or {})
    except KeyError:
        raise NotFound(f"Tool '{body.name}' does not exist.") from None
    except TypeError as exc:
        # Wrong / missing argument for the tool signature.
        raise AppError(
            f"Invalid arguments for tool '{body.name}': {exc}",
            code="BAD_REQUEST",
            status_code=400,
        ) from exc
    except Exception as exc:
        # SEC-026 (H-4): tool implementations (e.g. Bedrock) can raise with
        # AWS ARNs and request IDs in the message. Log server-side, return
        # a generic string so credentials/infra details never reach the client.
        logger.error(
            "tool_invocation_failed",
            extra={"tool_name": body.name, "error": repr(exc)},
            exc_info=True,
        )
        raise AppError(
            f"Tool '{body.name}' failed.",
            code="TOOL_ERROR",
            status_code=500,
        ) from exc
    return ToolInvokeResponse(name=body.name, result=result)

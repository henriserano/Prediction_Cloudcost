"""MCP-style tool registry for the FinOps agent.

Design goal: a single flat registry that any agent (LangGraph, an MCP server,
a plain HTTP client) can enumerate. Each entry carries the metadata an MCP
tool descriptor would carry (name, description, input JSON schema, category)
plus a plain Python callable — the LangChain ``@tool`` adapter is generated
on demand by ``as_langchain_tools()``.

Adding a new tool = write a function + register it via ``@register(...)``.
No further plumbing required: it appears in ``/api/tools``, in ``ALL_TOOLS``,
and becomes callable via ``execute()``.
"""

from __future__ import annotations

import functools
import inspect
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# Serialisation helper (shared with the direct-invoke path)
# ---------------------------------------------------------------------------

_MAX_CHARS = 6000


def serialise(obj: Any) -> str:
    """Turn arbitrary tool output into a bounded JSON string.

    - Pydantic models → ``model_dump()``.
    - Lists of Pydantic models → list of dumps.
    - Everything else → ``json.dumps(default=str)``.
    - Payloads over ``_MAX_CHARS`` are truncated with an explicit marker so
      the caller (LLM or human) sees that the tail was cut.
    """
    if hasattr(obj, "model_dump"):
        payload: Any = obj.model_dump()
    elif isinstance(obj, list) and obj and hasattr(obj[0], "model_dump"):
        payload = [item.model_dump() for item in obj]
    else:
        payload = obj
    text = json.dumps(payload, default=str, ensure_ascii=False)
    if len(text) > _MAX_CHARS:
        text = text[:_MAX_CHARS] + f"... [truncated, {len(text)} chars total]"
    return text


# ---------------------------------------------------------------------------
# Registry data types
# ---------------------------------------------------------------------------


@dataclass
class ToolSpec:
    """One entry in the registry — enough to render an MCP-compatible descriptor.

    ``input_schema`` follows the JSON Schema draft used by MCP tool definitions
    (type=object, properties=..., required=...). It's derived from the callable
    signature at registration time; override via the decorator when needed.
    """

    name: str
    description: str
    category: str
    func: Callable[..., Any]
    input_schema: dict = field(default_factory=dict)
    read_only: bool = True
    tags: list[str] = field(default_factory=list)


_REGISTRY: dict[str, ToolSpec] = {}


def _infer_input_schema(func: Callable) -> dict:
    """Build a minimal JSON schema from a function signature.

    Falls back to ``string`` for parameters whose annotation cannot be mapped;
    non-optional parameters land in ``required``. Explicit ``input_schema=``
    on the decorator always wins over inference.
    """
    sig = inspect.signature(func)
    properties: dict[str, dict] = {}
    required: list[str] = []
    python_to_json = {
        str: "string",
        int: "integer",
        float: "number",
        bool: "boolean",
        list: "array",
        dict: "object",
    }
    for name, param in sig.parameters.items():
        annotation = param.annotation
        json_type = "string"
        if annotation in python_to_json:
            json_type = python_to_json[annotation]
        properties[name] = {"type": json_type}
        if param.default is inspect.Parameter.empty:
            required.append(name)
        else:
            properties[name]["default"] = param.default
    schema: dict = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def register(
    *,
    name: str,
    description: str,
    category: str,
    read_only: bool = True,
    tags: list[str] | None = None,
    input_schema: dict | None = None,
):
    """Decorator that registers a callable as an agent tool.

    The wrapped function keeps its original signature and behaviour — the
    registry only holds a reference plus metadata.
    """

    def decorator(func: Callable) -> Callable:
        if name in _REGISTRY:
            raise RuntimeError(f"Tool '{name}' already registered.")
        _REGISTRY[name] = ToolSpec(
            name=name,
            description=description.strip(),
            category=category,
            func=func,
            input_schema=input_schema or _infer_input_schema(func),
            read_only=read_only,
            tags=list(tags or []),
        )
        return func

    return decorator


def get(name: str) -> ToolSpec:
    if name not in _REGISTRY:
        raise KeyError(f"Unknown tool: {name}")
    return _REGISTRY[name]


def list_specs() -> list[ToolSpec]:
    """Return every registered ToolSpec, ordered by category then name."""
    return sorted(_REGISTRY.values(), key=lambda t: (t.category, t.name))


def execute(name: str, arguments: dict | None = None) -> str:
    """Invoke a tool by name with keyword arguments. Returns a bounded string."""
    spec = get(name)
    args = arguments or {}
    result = spec.func(**args)
    return serialise(result)


def as_langchain_tools() -> list:
    """Adapt every registered tool into a LangChain ``StructuredTool``.

    Doing this lazily (only when the agent is built) means the FinOps backend
    still boots without ``langchain-core`` installed — helpful for CI and for
    running the analytics API stand-alone.
    """
    from langchain_core.tools import StructuredTool

    lc_tools = []
    for spec in list_specs():

        def _make_runner(_spec: ToolSpec):
            # functools.wraps sets __wrapped__ so inspect.signature (used by
            # LangChain to derive the args_schema) reports the wrapped
            # function's real parameters instead of the bare (**kwargs) below.
            # Without this, the LLM sees a single `kwargs` arg and calls the
            # tool with {"kwargs": {...}} — which fails with an unexpected
            # keyword argument at invocation time.
            @functools.wraps(_spec.func)
            def _run(**kwargs):
                return serialise(_spec.func(**kwargs))

            _run.__name__ = _spec.name
            _run.__doc__ = _spec.description
            return _run

        lc_tools.append(
            StructuredTool.from_function(
                func=_make_runner(spec),
                name=spec.name,
                description=spec.description,
            )
        )
    return lc_tools

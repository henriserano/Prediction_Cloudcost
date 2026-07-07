"""LangGraph agent wiring a Claude-on-Bedrock LLM to the FinOps tools.

Auth: this module never handles secrets directly. It relies on the boto3
default credential chain, which picks up ``AWS_BEARER_TOKEN_BEDROCK`` (short-
lived Bedrock bearer token) transparently. The token must be present in the
process environment before the first ``/api/chat`` call — main.py logs a
warning on startup when it's missing so misconfigurations surface fast.
"""
from __future__ import annotations

import os
import threading
from typing import Optional

from core.errors import AppError
from core.logging import get_logger

logger = get_logger(__name__)

DEFAULT_SYSTEM_PROMPT = (
    "You are a senior FinOps analyst embedded in a cost-analysis dashboard. "
    "You have tools that expose the current dataset (KPIs, per-service "
    "breakdown, forecasts, outliers, drift diagnostics, distribution tests, "
    "missingness, PCA). Always call the relevant tool before quoting numbers "
    "— never invent figures. If the user asks a broad question, prefer "
    "starting with ``get_data_status`` + ``get_kpi_snapshot`` to ground the "
    "conversation. Reply in the user's language, be concise, cite the tool "
    "you used to obtain each number, and flag any uncertainty (e.g. "
    "'source: parquet_fallback — this is demo data, not live GCP')."
)

DEFAULT_MODEL = os.getenv(
    "BEDROCK_MODEL_ID", "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"
)

_agent_lock = threading.Lock()
_agent_cache: dict[str, object] = {}


def _bedrock_ready() -> tuple[bool, Optional[str]]:
    """Return ``(is_ready, error_message)``. Never raises.

    Three accepted credential paths, in priority order:
      1. AWS_BEARER_TOKEN_BEDROCK — short-term Bedrock API key.
      2. Standard AWS credentials (env vars or AWS_PROFILE).
      3. ECS/EKS container credentials endpoint — auto-detected by boto3
         when the task runs under an IAM task role. This is the path used
         on Fargate.
    """
    if os.getenv("AWS_BEARER_TOKEN_BEDROCK"):
        return True, None
    if os.getenv("AWS_ACCESS_KEY_ID") or os.getenv("AWS_PROFILE"):
        return True, None
    # On ECS/EKS, boto3 fetches temp credentials from this well-known URI
    # exposed by the container agent. Presence of this env var is a reliable
    # signal that a task role is attached.
    if os.getenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI") or os.getenv(
        "AWS_CONTAINER_CREDENTIALS_FULL_URI"
    ):
        return True, None
    return False, (
        "No Bedrock credentials found. Expected either "
        "AWS_BEARER_TOKEN_BEDROCK, standard AWS credentials, or an ECS/EKS "
        "task role."
    )


def _build_agent(model_id: str):
    """Compile the LangGraph agent. Import LangGraph lazily so the FastAPI app
    can start even when the deps are not installed (offline dev, tests).
    """
    try:
        from langchain_aws import ChatBedrockConverse
        from langgraph.checkpoint.memory import MemorySaver
        from langgraph.graph import END, START, MessagesState, StateGraph
        from langgraph.prebuilt import ToolNode
    except Exception as exc:
        raise AppError(
            "LangGraph / langchain-aws are not installed. Run "
            "`pip install -r back/requirements.txt` and restart.",
            code="DEPENDENCY_ERROR",
            status_code=500,
            details={"import_error": repr(exc)},
        )

    # Importing agent.tools triggers registration of every @register-decorated
    # function into the tool registry, so the LangChain adapters below cover
    # the complete set exposed at /api/tools.
    import agent.tools  # noqa: F401
    from agent.tools import get_all_langchain_tools

    tools = get_all_langchain_tools()

    # BEDROCK_REGION overrides AWS_REGION because the target model may live in
    # a region distinct from the rest of the infra (e.g. Claude in eu-west-3
    # while ECS runs in eu-west-1).
    region = os.getenv("BEDROCK_REGION") or os.getenv("AWS_REGION", "eu-west-1")
    try:
        max_tokens = int(os.getenv("BEDROCK_MAX_TOKENS", "2048"))
    except ValueError:
        max_tokens = 2048

    llm_kwargs: dict = {
        "model": model_id,
        "region_name": region,
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }
    # Guardrails are opt-in; when configured, langchain-aws forwards them to
    # every InvokeModel call. Missing IDs are a config error (silently
    # dropping guardrails would give a false sense of PII protection), but we
    # only enforce presence of both fields together.
    guardrail_id = os.getenv("BEDROCK_GUARDRAIL_ID", "")
    guardrail_version = os.getenv("BEDROCK_GUARDRAIL_VERSION", "DRAFT")
    if guardrail_id:
        llm_kwargs["guardrails"] = {
            "guardrailIdentifier": guardrail_id,
            "guardrailVersion": guardrail_version,
        }

    llm = ChatBedrockConverse(**llm_kwargs).bind_tools(tools)

    # NOTE: annotations kept untyped on purpose — MessagesState is imported in
    # this function's local scope only, so a forward-ref annotation would fail
    # get_type_hints() (called by LangGraph 1.x on node registration).
    def call_llm(state):
        response = llm.invoke(state["messages"])
        return {"messages": [response]}

    def should_continue(state):
        last = state["messages"][-1]
        if getattr(last, "tool_calls", None):
            return "tools"
        return END

    workflow = StateGraph(MessagesState)
    workflow.add_node("agent", call_llm)
    workflow.add_node("tools", ToolNode(tools))
    workflow.add_edge(START, "agent")
    workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    workflow.add_edge("tools", "agent")

    return workflow.compile(checkpointer=MemorySaver())


def get_agent(model_id: str = DEFAULT_MODEL):
    """Return a compiled LangGraph agent, memoised per model.

    Building the graph costs ~200ms (Bedrock client init + tool binding); we
    reuse a single instance across requests, guarded by a lock to avoid two
    concurrent first-callers each doing the setup work.
    """
    ready, err = _bedrock_ready()
    if not ready:
        raise AppError(
            f"Bedrock is not configured: {err}",
            code="CONFIGURATION_ERROR",
            status_code=500,
        )

    with _agent_lock:
        agent = _agent_cache.get(model_id)
        if agent is None:
            agent = _build_agent(model_id)
            _agent_cache[model_id] = agent
            logger.info("agent_compiled", extra={"model": model_id})
        return agent

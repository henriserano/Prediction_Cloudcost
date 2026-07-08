"""Schemas for the agentic-project scoping simulator.

Flow:
- ``GET  /api/simulation/reference`` returns the static catalogs (LLM pricing,
  tool pricing, deployment options) so the frontend can render dropdowns
  without hardcoding.
- ``POST /api/simulation/estimate`` takes a set of scoping answers and
  returns a deterministic cost projection + architecture + risks.
- ``POST /api/simulation/push`` ingests the projection into the FinOps
  model as 12 monthly billing events (replace=false).
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


DeploymentTarget = Literal["bedrock", "anthropic_api", "openai_api", "azure_openai"]


class LLMPricingEntry(BaseModel):
    id: str
    label: str
    vendor: str
    provider: DeploymentTarget
    input_per_million: float = Field(description="USD per 1M input tokens")
    output_per_million: float = Field(description="USD per 1M output tokens")
    context_window: int = Field(description="Max context tokens")
    notes: Optional[str] = None


class ToolPricingEntry(BaseModel):
    id: str
    label: str
    unit_cost: float = Field(description="USD per call")
    description: str


class ReferenceCatalog(BaseModel):
    llms: list[LLMPricingEntry]
    tools: list[ToolPricingEntry]
    deployment_targets: list[dict] = Field(
        description="Deployment presets with baseline infra cost hints."
    )


class SimulationInputs(BaseModel):
    """Scoping-workshop answers."""

    project_name: str = Field(default="Agentic project", max_length=120)
    monthly_active_users: int = Field(ge=1, le=10_000_000)
    interactions_per_user_per_month: int = Field(ge=1, le=100_000)
    agents_count: int = Field(ge=1, le=100, description="Number of specialised agents")
    avg_turns_per_interaction: float = Field(default=3.0, ge=1.0, le=50.0)
    llm_id: str = Field(description="ID from ReferenceCatalog.llms")
    tool_ids: list[str] = Field(default_factory=list)
    avg_input_tokens_per_turn: int = Field(default=1500, ge=100, le=200_000)
    avg_output_tokens_per_turn: int = Field(default=350, ge=10, le=100_000)
    deployment: DeploymentTarget = Field(default="bedrock")
    has_guardrails: bool = Field(default=False)
    has_caching: bool = Field(default=False)


class CostBreakdown(BaseModel):
    llm_input: float
    llm_output: float
    tools: float
    infrastructure: float
    total_monthly: float
    currency: str = "USD"


class Risk(BaseModel):
    severity: Literal["info", "low", "medium", "high", "critical"]
    category: str
    title: str
    detail: str


class ArchitectureRecommendation(BaseModel):
    component: str
    reason: str


class BaselineContext(BaseModel):
    """Snapshot from the platform's currently-ingested data — the baseline
    against which the projected agentic cost is compared."""

    monthly_avg: float
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    top_service: Optional[str] = None
    source: str


class SimulationResult(BaseModel):
    inputs: SimulationInputs
    baseline: BaselineContext
    cost: CostBreakdown
    projected_monthly_events: list[dict] = Field(
        description="12 forward-looking monthly events, ready to POST to /api/events."
    )
    delta_vs_baseline_pct: float = Field(
        description="How much the agentic project would grow the current bill, in %."
    )
    architecture: list[ArchitectureRecommendation]
    risks: list[Risk]
    analysis_axes: list[str] = Field(
        description="Suggested next-step analyses the workshop should run."
    )


class SimulationPushRequest(BaseModel):
    events: list[dict] = Field(
        description="Pass ``projected_monthly_events`` from a SimulationResult."
    )
    project_name: str = Field(max_length=120)


class SimulationPushResponse(BaseModel):
    ingested: int
    project_name: str
    period_start: str
    period_end: str

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

from typing import Literal

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
    notes: str | None = None


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


RiskSeverity = Literal["info", "low", "medium", "high", "critical"]
RiskCategory = Literal[
    "budget",
    "model_choice",
    "cost_optim",
    "compliance",
    "security",
    "technical",
    "architecture",
    "vendor_lockin",
    "operational",
    "product",
    "baseline",
]
RiskTimeHorizon = Literal["before_launch", "first_month", "ongoing"]
RiskOwner = Literal["finops", "security", "engineering", "product", "compliance", "leadership"]


class Risk(BaseModel):
    """Actionable risk item surfaced by the scoping simulator.

    The extra fields (``mitigation``, ``owner``, ``time_horizon``,
    ``estimated_impact_usd``) turn what used to be a bullet into a workable
    to-do : *who* addresses it, *when*, *how*, and *how much* is at stake.
    Missing fields render as "N/A" client-side rather than crashing.
    """

    severity: RiskSeverity
    category: RiskCategory
    title: str
    detail: str
    mitigation: str | None = Field(
        default=None,
        description="Concrete next step that closes the risk (one sentence, actionable).",
    )
    owner: RiskOwner | None = Field(
        default=None,
        description="Who typically owns fixing this in the org.",
    )
    time_horizon: RiskTimeHorizon | None = Field(
        default=None,
        description="When this should be handled — before go-live vs. during ops.",
    )
    estimated_impact_usd: float | None = Field(
        default=None,
        description="Best-effort quantification of the risk cost (monthly USD).",
    )
    references: list[str] = Field(
        default_factory=list,
        description="Doc / runbook titles that ground the recommendation.",
    )


ArchitecturePhase = Literal["mvp", "scale", "hardening"]
ArchitectureImpact = Literal[
    "cost",
    "latency",
    "security",
    "reliability",
    "observability",
    "quality",
    "compliance",
]
ArchitecturePriority = Literal["must_have", "recommended", "nice_to_have"]
ArchitectureEffort = Literal["S", "M", "L"]


class ArchitectureRecommendation(BaseModel):
    """One architecture component the scoping deck should list.

    Extended fields make each recommendation defensible in a client workshop:
    prioritisation dictates what makes the MVP, ``impact`` names the axis it
    moves, ``effort`` sets expectations for delivery, and ``phase`` groups
    the list into a natural build sequence.
    """

    component: str
    reason: str
    priority: ArchitecturePriority = "recommended"
    impact: ArchitectureImpact = "reliability"
    effort: ArchitectureEffort = "M"
    phase: ArchitecturePhase = "mvp"
    est_cost_delta_pct: float | None = Field(
        default=None,
        description=(
            "Signed delta on the total_monthly bill if this recommendation is "
            "adopted. Positive = adds cost, negative = savings."
        ),
    )
    references: list[str] = Field(default_factory=list)


class AnalysisAxis(BaseModel):
    """A follow-up analysis worth running after the workshop.

    Structured (title + rationale + how_to) so a delivery lead can hand it
    directly to an analyst instead of translating a one-line hint.
    """

    title: str
    rationale: str
    how_to: str
    category: Literal["sensitivity", "unit_economics", "quality", "ops", "commercial"] = (
        "sensitivity"
    )


class ExecutiveSummary(BaseModel):
    """One-glance summary rendered at the top of the scoping deck / tab.

    Deterministic strings built from the inputs + cost breakdown so the
    frontend has nothing to compute on its side and the copy stays consistent
    with what the risks / recommendations describe below.
    """

    headline: str = Field(description="One-sentence framing of the project size.")
    monthly_bill_usd: float
    annual_bill_usd: float
    delta_vs_baseline_pct: float
    dominant_cost_driver: Literal["llm_input", "llm_output", "tools", "infrastructure"]
    dominant_cost_driver_pct: float
    unit_cost_per_interaction_usd: float = Field(
        description="Total monthly cost divided by projected interactions per month."
    )
    unit_cost_per_user_usd: float = Field(description="Total monthly cost divided by MAU.")
    confidence: Literal["low", "medium", "high"] = Field(
        default="medium",
        description="How much to trust the numbers — driven by baseline availability + token estimates.",
    )
    confidence_notes: list[str] = Field(
        default_factory=list,
        description="Reasons the confidence was raised/lowered.",
    )


class BaselineContext(BaseModel):
    """Snapshot from the platform's currently-ingested data — the baseline
    against which the projected agentic cost is compared."""

    monthly_avg: float
    period_start: str | None = None
    period_end: str | None = None
    top_service: str | None = None
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
    executive_summary: ExecutiveSummary
    architecture: list[ArchitectureRecommendation]
    risks: list[Risk]
    analysis_axes: list[AnalysisAxis] = Field(
        description="Suggested next-step analyses the workshop should run.",
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

"""Deterministic scoping simulator for agentic projects.

Given a set of workshop answers (nb agents, users, LLM, tools…), returns a
cost projection, a target architecture, and a list of risks. No LLM call —
everything is rule-based so the same inputs always yield the same output.

Pricing sourced from vendors' public rate cards. See :data:`LLM_CATALOG` for
the reference values. Bake in whatever your commercial team negotiated by
overriding these; the estimator will use the new numbers as-is.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from schemas.simulation import (
    ArchitectureRecommendation,
    BaselineContext,
    CostBreakdown,
    LLMPricingEntry,
    ReferenceCatalog,
    Risk,
    SimulationInputs,
    SimulationResult,
    ToolPricingEntry,
)


# ---------------------------------------------------------------------------
# Reference catalogs
# ---------------------------------------------------------------------------

LLM_CATALOG: list[LLMPricingEntry] = [
    LLMPricingEntry(
        id="claude-opus-4-7",
        label="Claude Opus 4.7",
        vendor="Anthropic",
        provider="bedrock",
        input_per_million=15.0,
        output_per_million=75.0,
        context_window=200_000,
        notes="Top-of-the-line reasoning; keep for hard problems only.",
    ),
    LLMPricingEntry(
        id="claude-sonnet-4-6",
        label="Claude Sonnet 4.6",
        vendor="Anthropic",
        provider="bedrock",
        input_per_million=3.0,
        output_per_million=15.0,
        context_window=200_000,
        notes="Best value/quality balance for most agentic workloads.",
    ),
    LLMPricingEntry(
        id="claude-sonnet-4-5",
        label="Claude Sonnet 4.5",
        vendor="Anthropic",
        provider="bedrock",
        input_per_million=3.0,
        output_per_million=15.0,
        context_window=200_000,
    ),
    LLMPricingEntry(
        id="claude-haiku-4-5",
        label="Claude Haiku 4.5",
        vendor="Anthropic",
        provider="bedrock",
        input_per_million=1.0,
        output_per_million=5.0,
        context_window=200_000,
        notes="Cheapest Anthropic option; great for high-volume routing.",
    ),
    LLMPricingEntry(
        id="gpt-4o",
        label="GPT-4o",
        vendor="OpenAI",
        provider="openai_api",
        input_per_million=2.5,
        output_per_million=10.0,
        context_window=128_000,
    ),
    LLMPricingEntry(
        id="gpt-4o-mini",
        label="GPT-4o mini",
        vendor="OpenAI",
        provider="openai_api",
        input_per_million=0.15,
        output_per_million=0.60,
        context_window=128_000,
        notes="Very cheap; degrades on multi-step reasoning.",
    ),
    LLMPricingEntry(
        id="nova-pro",
        label="Amazon Nova Pro",
        vendor="Amazon",
        provider="bedrock",
        input_per_million=0.80,
        output_per_million=3.20,
        context_window=300_000,
    ),
]

TOOL_CATALOG: list[ToolPricingEntry] = [
    ToolPricingEntry(
        id="web_search", label="Web search (Brave/Google)",
        unit_cost=0.005,
        description="External web search API used inside the agent's tool loop.",
    ),
    ToolPricingEntry(
        id="rag_retrieval", label="Vector RAG retrieval",
        unit_cost=0.0001,
        description="Query against a hosted vector DB (OpenSearch, Pinecone).",
    ),
    ToolPricingEntry(
        id="code_exec", label="Code execution sandbox",
        unit_cost=0.001,
        description="Bedrock Code Interpreter / Firecracker VM per call.",
    ),
    ToolPricingEntry(
        id="ocr_extraction", label="Document OCR extraction",
        unit_cost=0.010,
        description="Textract / equivalent, per page/document processed.",
    ),
    ToolPricingEntry(
        id="function_call", label="Custom internal API call",
        unit_cost=0.0002,
        description="Rough estimate for internal REST calls (compute + egress).",
    ),
    ToolPricingEntry(
        id="voice_transcription", label="Voice-to-text (Deepgram/Whisper)",
        unit_cost=0.008,
        description="Streaming transcription per minute of audio.",
    ),
]

DEPLOYMENT_TARGETS: list[dict] = [
    {"id": "bedrock", "label": "AWS Bedrock", "base_infra_usd": 200},
    {"id": "anthropic_api", "label": "Anthropic API", "base_infra_usd": 150},
    {"id": "openai_api", "label": "OpenAI API", "base_infra_usd": 150},
    {"id": "azure_openai", "label": "Azure OpenAI", "base_infra_usd": 250},
]


def get_reference_catalog() -> ReferenceCatalog:
    return ReferenceCatalog(
        llms=LLM_CATALOG, tools=TOOL_CATALOG, deployment_targets=DEPLOYMENT_TARGETS
    )


# ---------------------------------------------------------------------------
# Baseline extraction — reads whatever cost history is currently ingested
# ---------------------------------------------------------------------------

def _current_baseline() -> BaselineContext:
    """Snapshot the current monthly avg + top service from the platform data.

    Falls back to zero values (with ``source="empty"``) when the ingest is
    empty, so the estimator still returns something meaningful in an
    unconfigured environment.
    """
    try:
        from data.loader import load_daily_costs, load_daily_per_service
    except Exception:
        return BaselineContext(monthly_avg=0.0, source="unavailable")

    try:
        df = load_daily_costs()
    except Exception:
        return BaselineContext(monthly_avg=0.0, source="unavailable")

    if df is None or df.empty:
        return BaselineContext(monthly_avg=0.0, source="empty")

    # loader canon: columns are ``ds`` (date) + ``y`` (daily cost).
    cost_col = "y" if "y" in df.columns else ("cost" if "cost" in df.columns else None)
    date_col = "ds" if "ds" in df.columns else ("date" if "date" in df.columns else None)
    if not cost_col:
        return BaselineContext(monthly_avg=0.0, source="empty")

    daily_avg = float(df[cost_col].mean())
    monthly_avg = round(daily_avg * 30, 2)
    period_start = str(df[date_col].min())[:10] if date_col else None
    period_end = str(df[date_col].max())[:10] if date_col else None

    top_service: Optional[str] = None
    try:
        df_svc = load_daily_per_service()
        if df_svc is not None and not df_svc.empty:
            svc_cost_col = "y" if "y" in df_svc.columns else (
                "cost" if "cost" in df_svc.columns else None
            )
            if svc_cost_col and "service" in df_svc.columns:
                top_service = str(df_svc.groupby("service")[svc_cost_col].sum().idxmax())
    except Exception:
        pass

    return BaselineContext(
        monthly_avg=monthly_avg,
        period_start=period_start,
        period_end=period_end,
        top_service=top_service,
        source="ingested_data",
    )


# ---------------------------------------------------------------------------
# Cost estimation
# ---------------------------------------------------------------------------

def _find_llm(llm_id: str) -> LLMPricingEntry:
    for entry in LLM_CATALOG:
        if entry.id == llm_id:
            return entry
    raise ValueError(f"Unknown LLM id: {llm_id}")


def _find_tool(tool_id: str) -> Optional[ToolPricingEntry]:
    for entry in TOOL_CATALOG:
        if entry.id == tool_id:
            return entry
    return None


def _base_infra_cost(deployment: str, users: int) -> float:
    """Rough infra baseline. Scales with user count in coarse steps — the
    workshop only needs orders of magnitude, not precision to the cent."""
    presets = {p["id"]: p["base_infra_usd"] for p in DEPLOYMENT_TARGETS}
    base = float(presets.get(deployment, 200))
    if users >= 10_000:
        return base * 8.0
    if users >= 1_000:
        return base * 3.0
    if users >= 100:
        return base * 1.5
    return base


def _estimate_cost(inputs: SimulationInputs) -> CostBreakdown:
    llm = _find_llm(inputs.llm_id)

    # Total agent turns per month = users × interactions × turns × agents-per-turn
    # (agents_count acts as a multiplier: with 3 specialised agents cooperating,
    # each user interaction touches ~agents_count agents on average).
    turns_per_month = (
        inputs.monthly_active_users
        * inputs.interactions_per_user_per_month
        * inputs.avg_turns_per_interaction
        * inputs.agents_count
    )

    input_tokens_month = turns_per_month * inputs.avg_input_tokens_per_turn
    output_tokens_month = turns_per_month * inputs.avg_output_tokens_per_turn

    # Prompt caching typically halves the effective input cost for repeated
    # system prompts / RAG context — apply a 50% discount when enabled.
    input_cost_multiplier = 0.5 if inputs.has_caching else 1.0

    llm_input_cost = (input_tokens_month / 1_000_000) * llm.input_per_million * input_cost_multiplier
    llm_output_cost = (output_tokens_month / 1_000_000) * llm.output_per_million

    tool_cost = 0.0
    for tool_id in inputs.tool_ids:
        tool = _find_tool(tool_id)
        if tool:
            # Approximation: each turn triggers one call to each enabled tool.
            tool_cost += turns_per_month * tool.unit_cost

    infra = _base_infra_cost(inputs.deployment, inputs.monthly_active_users)
    if inputs.has_guardrails:
        # Bedrock Guardrails: ~$0.75 per 1k text units. Approx as 5% of LLM spend.
        infra += (llm_input_cost + llm_output_cost) * 0.05

    total = llm_input_cost + llm_output_cost + tool_cost + infra
    return CostBreakdown(
        llm_input=round(llm_input_cost, 2),
        llm_output=round(llm_output_cost, 2),
        tools=round(tool_cost, 2),
        infrastructure=round(infra, 2),
        total_monthly=round(total, 2),
    )


# ---------------------------------------------------------------------------
# Architecture recommendations (rule-based)
# ---------------------------------------------------------------------------

def _recommend_architecture(inputs: SimulationInputs) -> list[ArchitectureRecommendation]:
    recs: list[ArchitectureRecommendation] = [
        ArchitectureRecommendation(
            component="API Gateway + FastAPI",
            reason="Front the agent behind a rate-limited HTTPS endpoint (JWT auth, WAF).",
        ),
    ]
    if inputs.agents_count >= 3:
        recs.append(ArchitectureRecommendation(
            component="LangGraph / Step Functions orchestrator",
            reason=f"{inputs.agents_count} specialised agents need explicit routing and state handoff.",
        ))
    else:
        recs.append(ArchitectureRecommendation(
            component="Single-agent loop (Bedrock Converse tool-use)",
            reason="One agent is enough at this scale; skip the orchestrator complexity.",
        ))
    if any(t in inputs.tool_ids for t in ("rag_retrieval",)):
        recs.append(ArchitectureRecommendation(
            component="Managed vector DB (OpenSearch Serverless / Pinecone)",
            reason="RAG requires low-latency semantic search — commit to one hosted option.",
        ))
    if "code_exec" in inputs.tool_ids:
        recs.append(ArchitectureRecommendation(
            component="Sandboxed code interpreter (Bedrock CodeInterpreter or Firecracker VM)",
            reason="Never execute model-generated code in the app process.",
        ))
    if inputs.monthly_active_users >= 1_000:
        recs.append(ArchitectureRecommendation(
            component="Redis / ElastiCache prompt caching",
            reason=f"With {inputs.monthly_active_users:,} MAU, caching common completions cuts LLM cost 30-50%.",
        ))
    if not inputs.has_guardrails:
        recs.append(ArchitectureRecommendation(
            component="Bedrock Guardrails (PII + prompt-injection)",
            reason="Any production agent handling user data needs a PII filter and injection defense.",
        ))
    if inputs.monthly_active_users >= 5_000:
        recs.append(ArchitectureRecommendation(
            component="Async queue (SQS + worker pool)",
            reason="Peak-hour bursts above 5k MAU will exhaust synchronous connection pools.",
        ))
    recs.append(ArchitectureRecommendation(
        component="Observability (CloudWatch Logs + Langfuse/Arize)",
        reason="Track tokens, tool calls, latency and error rate per agent for FinOps + drift detection.",
    ))
    return recs


# ---------------------------------------------------------------------------
# Risks (rule-based)
# ---------------------------------------------------------------------------

def _assess_risks(
    inputs: SimulationInputs, cost: CostBreakdown, baseline: BaselineContext,
) -> list[Risk]:
    risks: list[Risk] = []
    llm = _find_llm(inputs.llm_id)

    # Cost delta vs current bill
    baseline_monthly = max(baseline.monthly_avg, 0.01)
    delta_pct = (cost.total_monthly / baseline_monthly) * 100
    if baseline.source == "ingested_data" and baseline.monthly_avg > 0:
        if delta_pct >= 100:
            risks.append(Risk(
                severity="high", category="budget",
                title=f"Le projet ajoute {delta_pct:.0f}% à la facture actuelle",
                detail=(
                    f"Simulation projetée : {cost.total_monthly:,.0f} USD/mois vs "
                    f"baseline actuel {baseline_monthly:,.0f} USD/mois. Requiert un "
                    "sponsor executive et un plan de contrôle de dépassement."
                ),
            ))
        elif delta_pct >= 40:
            risks.append(Risk(
                severity="medium", category="budget",
                title=f"Impact budgetaire notable (+{delta_pct:.0f}%)",
                detail="Alignement CFO recommandé avant lancement du delivery.",
            ))

    # Model choice risks
    if inputs.llm_id.startswith("claude-opus") and inputs.monthly_active_users > 500:
        risks.append(Risk(
            severity="high", category="model_choice",
            title="Opus + >500 MAU = coût disproportionné",
            detail=(
                "Opus coûte 5x plus qu'un Sonnet pour un usage haut-volume où "
                "l'écart qualité est marginal. Envisage Sonnet 4.6 pour la majorité "
                "des interactions, Opus uniquement en escalade."
            ),
        ))

    # Cache absence at scale
    if inputs.monthly_active_users >= 1_000 and not inputs.has_caching:
        est_saving = round(cost.llm_input * 0.5, 0)
        risks.append(Risk(
            severity="medium", category="cost_optim",
            title="Cache prompt désactivé",
            detail=(
                f"Activer le prompt caching réduirait ~{est_saving:,.0f} USD/mois d'input "
                "tokens. Prio 1 pour tout POC qui bascule en prod."
            ),
        ))

    # Guardrails absence
    if not inputs.has_guardrails:
        risks.append(Risk(
            severity="high", category="compliance",
            title="Pas de guardrails PII / prompt-injection",
            detail=(
                "Un agent en contact avec des données utilisateur sans guardrails est "
                "un incident de confidentialité potentiel. Bedrock Guardrails ajoute ~5% "
                "au coût LLM pour un ROI évident."
            ),
        ))

    # Context window vs configured tokens
    context_used = inputs.avg_input_tokens_per_turn * inputs.avg_turns_per_interaction
    if context_used > llm.context_window * 0.7:
        risks.append(Risk(
            severity="high", category="technical",
            title="Contexte saturé en fin de conversation",
            detail=(
                f"{context_used:,.0f} tokens accumulés vs fenêtre de {llm.context_window:,} — "
                "risque de troncature agressive. Ajoute une stratégie de résumé ou "
                "choisis un modèle au contexte plus large."
            ),
        ))

    # Multi-agent without orchestration reasoning
    if inputs.agents_count >= 5:
        risks.append(Risk(
            severity="medium", category="architecture",
            title=f"{inputs.agents_count} agents = complexité opérationnelle",
            detail=(
                "Au-delà de 4-5 agents, le traçage des décisions devient coûteux. "
                "Investis dans un orchestrateur explicite (LangGraph) et Langfuse pour la trace."
            ),
        ))

    # Very high token count per turn (probably RAG mis-tuned)
    if inputs.avg_input_tokens_per_turn > 20_000:
        risks.append(Risk(
            severity="medium", category="cost_optim",
            title="Input tokens/turn très élevé (>20k)",
            detail=(
                "Symptomatique d'un RAG qui remonte trop de chunks, ou d'un system "
                "prompt trop long. Diminuer de moitié divise le coût input par 2."
            ),
        ))

    if not risks:
        risks.append(Risk(
            severity="info", category="baseline",
            title="Aucun risque bloquant identifié",
            detail="Configuration cohérente. Repasse cette analyse quand tes chiffres bougent.",
        ))

    return risks


# ---------------------------------------------------------------------------
# Analysis axes — points to explore next
# ---------------------------------------------------------------------------

def _suggested_axes(inputs: SimulationInputs, cost: CostBreakdown) -> list[str]:
    axes = [
        "Sensibilité : varier ±30% le nombre d'utilisateurs et observer l'inflexion coût",
        "Comparer 2 modèles LLM (Sonnet 4.6 vs Haiku 4.5) pour trancher rapport qualité/prix",
        "Estimer la latence utilisateur cible (P50/P95) et son impact sur le nombre d'agents",
    ]
    if cost.tools > cost.llm_input + cost.llm_output:
        axes.append("Poids des tools > LLM : vérifier si tous les appels sont réellement utiles")
    if inputs.monthly_active_users >= 500:
        axes.append("Simuler le pic mensuel (2x moyenne) pour dimensionner l'autoscaling")
    axes.append("Cout par interaction utilisateur (unit economics) — clé pour la pricing produit")
    return axes


# ---------------------------------------------------------------------------
# Forward monthly events for the FinOps model
# ---------------------------------------------------------------------------

def _projected_events(inputs: SimulationInputs, cost: CostBreakdown) -> list[dict]:
    """12 forward-looking monthly events, one per cost component.

    We spread each component evenly across the year — the FinOps forecast
    module smooths trend on top, so month-to-month noise isn't useful here.
    """
    llm_id = inputs.llm_id
    today = date.today().replace(day=1)
    events: list[dict] = []
    per_component = [
        (f"AI Agent - {llm_id} input", cost.llm_input),
        (f"AI Agent - {llm_id} output", cost.llm_output),
        ("AI Agent - Tools", cost.tools),
        ("AI Agent - Infrastructure", cost.infrastructure),
    ]
    description_suffix = inputs.project_name.strip() or "Agentic project"
    for month_offset in range(12):
        # Bump the month by roughly 30 days; the first of the month is enough
        # for a monthly-granular projection.
        anchor = today + timedelta(days=30 * (month_offset + 1))
        month_start = anchor.replace(day=1)
        for service, amount in per_component:
            if amount <= 0:
                continue
            events.append({
                "date": month_start.isoformat(),
                "service": service,
                "cost": round(amount, 2),
                "description": f"Projected cost — {description_suffix}",
            })
    return events


# ---------------------------------------------------------------------------
# Public entry-point
# ---------------------------------------------------------------------------

def simulate(inputs: SimulationInputs) -> SimulationResult:
    baseline = _current_baseline()
    cost = _estimate_cost(inputs)
    delta_pct = (
        (cost.total_monthly / baseline.monthly_avg) * 100
        if baseline.monthly_avg > 0
        else 0.0
    )
    return SimulationResult(
        inputs=inputs,
        baseline=baseline,
        cost=cost,
        projected_monthly_events=_projected_events(inputs, cost),
        delta_vs_baseline_pct=round(delta_pct, 1),
        architecture=_recommend_architecture(inputs),
        risks=_assess_risks(inputs, cost, baseline),
        analysis_axes=_suggested_axes(inputs, cost),
    )

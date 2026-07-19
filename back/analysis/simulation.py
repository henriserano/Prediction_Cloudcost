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
from typing import Literal

from schemas.simulation import (
    AnalysisAxis,
    ArchitectureRecommendation,
    BaselineContext,
    CostBreakdown,
    ExecutiveSummary,
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
        id="web_search",
        label="Web search (Brave/Google)",
        unit_cost=0.005,
        description="External web search API used inside the agent's tool loop.",
    ),
    ToolPricingEntry(
        id="rag_retrieval",
        label="Vector RAG retrieval",
        unit_cost=0.0001,
        description="Query against a hosted vector DB (OpenSearch, Pinecone).",
    ),
    ToolPricingEntry(
        id="code_exec",
        label="Code execution sandbox",
        unit_cost=0.001,
        description="Bedrock Code Interpreter / Firecracker VM per call.",
    ),
    ToolPricingEntry(
        id="ocr_extraction",
        label="Document OCR extraction",
        unit_cost=0.010,
        description="Textract / equivalent, per page/document processed.",
    ),
    ToolPricingEntry(
        id="function_call",
        label="Custom internal API call",
        unit_cost=0.0002,
        description="Rough estimate for internal REST calls (compute + egress).",
    ),
    ToolPricingEntry(
        id="voice_transcription",
        label="Voice-to-text (Deepgram/Whisper)",
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

    top_service: str | None = None
    try:
        df_svc = load_daily_per_service()
        if df_svc is not None and not df_svc.empty:
            svc_cost_col = (
                "y" if "y" in df_svc.columns else ("cost" if "cost" in df_svc.columns else None)
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


def _find_tool(tool_id: str) -> ToolPricingEntry | None:
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

    llm_input_cost = (
        (input_tokens_month / 1_000_000) * llm.input_per_million * input_cost_multiplier
    )
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
    """Return the target-architecture blueprint, phased and prioritised.

    Every recommendation carries a ``phase`` (mvp / scale / hardening),
    ``priority`` (must_have / recommended / nice_to_have), ``impact`` axis and
    ``effort`` tag so the workshop deck can filter/sort them without
    guesswork. Order in the returned list follows a natural build sequence.
    """
    recs: list[ArchitectureRecommendation] = []

    # ─── MVP · foundations ────────────────────────────────────────────────
    recs.append(
        ArchitectureRecommendation(
            component="API Gateway + FastAPI (JWT + WAF + rate limits)",
            reason=(
                "Front the agent behind a rate-limited HTTPS endpoint with JWT auth and a WAF. "
                "Blocks abuse, gives you a single choke-point for throttling and audit logs."
            ),
            priority="must_have",
            impact="security",
            effort="S",
            phase="mvp",
            references=["AWS API Gateway best practices"],
        )
    )

    if inputs.agents_count >= 3:
        recs.append(
            ArchitectureRecommendation(
                component="LangGraph / Step Functions orchestrator",
                reason=(
                    f"{inputs.agents_count} specialised agents need explicit routing, state handoff and "
                    "durable checkpoints. A ReAct loop won't survive the coordination complexity."
                ),
                priority="must_have",
                impact="reliability",
                effort="M",
                phase="mvp",
                references=["LangGraph state machines", "AWS Step Functions patterns"],
            )
        )
    else:
        recs.append(
            ArchitectureRecommendation(
                component="Single-agent loop (Bedrock Converse tool-use)",
                reason=(
                    "One agent is enough at this scale; skip the orchestrator complexity — you can "
                    "still swap in LangGraph later without changing the outward contract."
                ),
                priority="must_have",
                impact="reliability",
                effort="S",
                phase="mvp",
            )
        )

    if "rag_retrieval" in inputs.tool_ids:
        recs.append(
            ArchitectureRecommendation(
                component="Managed vector DB (OpenSearch Serverless / Pinecone)",
                reason=(
                    "RAG requires low-latency (p95 < 100 ms) semantic search. Commit to a hosted "
                    "option instead of self-hosting Weaviate/Milvus in the MVP."
                ),
                priority="must_have",
                impact="latency",
                effort="M",
                phase="mvp",
            )
        )

    if "code_exec" in inputs.tool_ids:
        recs.append(
            ArchitectureRecommendation(
                component="Sandboxed code interpreter (Bedrock CodeInterpreter or Firecracker VM)",
                reason=(
                    "Never execute model-generated code in the app process. A dedicated sandbox with "
                    "network egress off + ephemeral filesystem is non-negotiable."
                ),
                priority="must_have",
                impact="security",
                effort="M",
                phase="mvp",
            )
        )

    if "ocr_extraction" in inputs.tool_ids:
        recs.append(
            ArchitectureRecommendation(
                component="Async OCR pipeline (SQS + Textract worker)",
                reason=(
                    "Textract is not real-time. Front the OCR step with SQS + a worker pool so the "
                    "agent turn doesn't block on a 15-30 s document parse."
                ),
                priority="recommended",
                impact="latency",
                effort="M",
                phase="mvp",
            )
        )

    # ─── Scale · cost + throughput ────────────────────────────────────────
    if inputs.monthly_active_users >= 1_000:
        recs.append(
            ArchitectureRecommendation(
                component="Prompt caching (Bedrock / Anthropic / Redis fallback)",
                reason=(
                    f"With {inputs.monthly_active_users:,} MAU, caching the system prompt + tool schemas "
                    "cuts input-token cost by 30-50 % — the ROI dwarfs the ~2 h setup."
                ),
                priority="recommended",
                impact="cost",
                effort="S",
                phase="scale",
                est_cost_delta_pct=-15.0,
                references=["Anthropic prompt caching guide", "Bedrock cache docs"],
            )
        )

    if inputs.monthly_active_users >= 5_000:
        recs.append(
            ArchitectureRecommendation(
                component="Async job queue (SQS + autoscaled worker pool)",
                reason=(
                    "Peak-hour bursts above 5k MAU exhaust synchronous connection pools and blow up "
                    "the ALB queue. Move long tool calls behind SQS with a Fargate worker pool."
                ),
                priority="recommended",
                impact="reliability",
                effort="M",
                phase="scale",
            )
        )

    if inputs.monthly_active_users >= 10_000:
        recs.append(
            ArchitectureRecommendation(
                component="Multi-region active-passive (or read-only failover)",
                reason=(
                    "At 10k+ MAU a single-region outage is a P1 incident. Provision a warm secondary "
                    "in a second region behind Route 53 health checks."
                ),
                priority="nice_to_have",
                impact="reliability",
                effort="L",
                phase="scale",
            )
        )

    if inputs.llm_id.startswith("claude-opus") or inputs.avg_input_tokens_per_turn > 8_000:
        recs.append(
            ArchitectureRecommendation(
                component="Model routing (Haiku ↔ Sonnet ↔ Opus)",
                reason=(
                    "Route trivial classifier / router turns to a cheap model, keep the expensive one "
                    "for the reasoning step. Typical saving: 30-60 % of LLM spend."
                ),
                priority="recommended",
                impact="cost",
                effort="M",
                phase="scale",
                est_cost_delta_pct=-25.0,
            )
        )

    # ─── Production hardening ─────────────────────────────────────────────
    if not inputs.has_guardrails:
        recs.append(
            ArchitectureRecommendation(
                component="Bedrock Guardrails (PII redaction + prompt-injection filter)",
                reason=(
                    "Any production agent touching user data needs PII redaction and a prompt-injection "
                    "defense. Bedrock Guardrails adds ~5 % to LLM spend for a defensible security posture."
                ),
                priority="must_have",
                impact="compliance",
                effort="S",
                phase="hardening",
                est_cost_delta_pct=5.0,
                references=["Bedrock Guardrails policies", "OWASP Top 10 for LLMs"],
            )
        )

    recs.append(
        ArchitectureRecommendation(
            component="Observability stack (CloudWatch + Langfuse/Arize + trace IDs)",
            reason=(
                "Track tokens, tool-call latencies, error rates and agent decisions per turn. "
                "Without traces you can't debug production, run FinOps or detect quality drift."
            ),
            priority="must_have",
            impact="observability",
            effort="M",
            phase="hardening",
            references=["Langfuse quickstart", "Arize AX for LLM apps"],
        )
    )

    recs.append(
        ArchitectureRecommendation(
            component="Evaluation harness (offline set + prod sampling)",
            reason=(
                "Freeze 100-500 canonical prompts + expected outputs and run them nightly on every "
                "new model version. Catches regressions before users do."
            ),
            priority="recommended",
            impact="quality",
            effort="M",
            phase="hardening",
        )
    )

    if inputs.monthly_active_users >= 500:
        recs.append(
            ArchitectureRecommendation(
                component="Per-user rate limits + budget circuit breaker",
                reason=(
                    "One abusive account can 10x your bill in a weekend. Enforce daily-token quotas "
                    "per user and a global spend circuit-breaker that trips at 120 % of forecast."
                ),
                priority="recommended",
                impact="cost",
                effort="S",
                phase="hardening",
            )
        )

    return recs


# ---------------------------------------------------------------------------
# Risks (rule-based)
# ---------------------------------------------------------------------------


def _assess_risks(
    inputs: SimulationInputs,
    cost: CostBreakdown,
    baseline: BaselineContext,
) -> list[Risk]:
    """Return the enriched risk register.

    Each entry carries a mitigation (concrete next step), an owner hint (who
    typically fixes it), a time horizon (when), and a rough monthly USD impact
    when quantifiable — enough to hand the list to a workshop steer-co
    without further translation.
    """
    risks: list[Risk] = []
    llm = _find_llm(inputs.llm_id)

    # ─── Budget delta vs. current bill ────────────────────────────────────
    baseline_monthly = max(baseline.monthly_avg, 0.01)
    delta_pct = (cost.total_monthly / baseline_monthly) * 100
    if baseline.source == "ingested_data" and baseline.monthly_avg > 0:
        if delta_pct >= 100:
            risks.append(
                Risk(
                    severity="critical",
                    category="budget",
                    title=f"Le projet ajoute {delta_pct:.0f}% à la facture cloud actuelle",
                    detail=(
                        f"Projection : {cost.total_monthly:,.0f} USD/mois contre baseline "
                        f"{baseline_monthly:,.0f} USD/mois. Sans sponsor exécutif et plan de "
                        "cadrage financier, le projet dépasse le seuil d'auto-approbation FinOps."
                    ),
                    mitigation=(
                        "Bloquer une revue CFO/FinOps avant kickoff. Cadrer un budget mensuel "
                        "avec circuit-breaker à 120 % et rapport hebdomadaire."
                    ),
                    owner="leadership",
                    time_horizon="before_launch",
                    estimated_impact_usd=round(cost.total_monthly, 0),
                    references=["FinOps Foundation cost-control playbook"],
                )
            )
        elif delta_pct >= 40:
            risks.append(
                Risk(
                    severity="high",
                    category="budget",
                    title=f"Impact budgétaire notable (+{delta_pct:.0f}% du bill)",
                    detail=(
                        f"+{cost.total_monthly - baseline_monthly:,.0f} USD/mois net. Nécessite un "
                        "alignement CFO/FinOps et un budget dédié avant delivery."
                    ),
                    mitigation="Documenter le business case chiffré et obtenir l'accord CFO sur un plafond mensuel.",
                    owner="finops",
                    time_horizon="before_launch",
                    estimated_impact_usd=round(cost.total_monthly - baseline_monthly, 0),
                )
            )
        elif delta_pct >= 15:
            risks.append(
                Risk(
                    severity="medium",
                    category="budget",
                    title=f"Impact budgétaire modéré (+{delta_pct:.0f}%)",
                    detail=(
                        "Impact absorbable dans un budget IT courant mais mérite un tracking "
                        "dédié sur le premier trimestre après go-live."
                    ),
                    mitigation="Créer un tag/label 'agent-project' sur toutes les ressources pour le suivi FinOps.",
                    owner="finops",
                    time_horizon="first_month",
                    estimated_impact_usd=round(cost.total_monthly - baseline_monthly, 0),
                )
            )

    # ─── Model choice — Opus at scale ─────────────────────────────────────
    if inputs.llm_id.startswith("claude-opus") and inputs.monthly_active_users > 500:
        sonnet_saving = round(cost.llm_input * 0.8 + cost.llm_output * 0.8, 0)
        risks.append(
            Risk(
                severity="high",
                category="model_choice",
                title="Opus + >500 MAU = coût disproportionné",
                detail=(
                    "Opus coûte 5x plus qu'un Sonnet pour un usage haut-volume où l'écart "
                    "qualité est marginal sur la plupart des tâches d'agent."
                ),
                mitigation=(
                    "Router les turns simples (classifier, extraction, tool routing) vers "
                    "Sonnet 4.6 ou Haiku 4.5 ; garder Opus pour l'escalade explicite."
                ),
                owner="engineering",
                time_horizon="before_launch",
                estimated_impact_usd=sonnet_saving,
            )
        )

    # ─── Cost optim — prompt caching absent at scale ──────────────────────
    if inputs.monthly_active_users >= 1_000 and not inputs.has_caching:
        est_saving = round(cost.llm_input * 0.5, 0)
        risks.append(
            Risk(
                severity="medium",
                category="cost_optim",
                title="Prompt caching désactivé (>1k MAU)",
                detail=(
                    f"Activer le prompt caching sur le system prompt + les tool schemas "
                    f"économiserait ~{est_saving:,.0f} USD/mois. Setup ≈ 2 h."
                ),
                mitigation="Activer bedrock-cache ou anthropic prompt-caching sur le prompt fixe.",
                owner="engineering",
                time_horizon="first_month",
                estimated_impact_usd=est_saving,
                references=["Anthropic prompt caching guide"],
            )
        )

    # ─── Compliance — guardrails absent ───────────────────────────────────
    if not inputs.has_guardrails:
        risks.append(
            Risk(
                severity="high",
                category="compliance",
                title="Pas de guardrails PII / prompt-injection",
                detail=(
                    "Un agent qui traite des données utilisateur sans PII-filter ni défense "
                    "contre le prompt injection expose l'entreprise à un incident de "
                    "confidentialité (GDPR art. 32). Bedrock Guardrails ajoute ~5 % au coût LLM."
                ),
                mitigation="Provisionner Bedrock Guardrails avec les politiques PII + jailbreak avant go-live.",
                owner="security",
                time_horizon="before_launch",
                estimated_impact_usd=round(cost.total_monthly * 0.05, 0),
                references=["OWASP LLM Top 10", "GDPR art. 32"],
            )
        )

    # ─── Technical — context window saturation ────────────────────────────
    context_used = inputs.avg_input_tokens_per_turn * inputs.avg_turns_per_interaction
    if context_used > llm.context_window * 0.7:
        risks.append(
            Risk(
                severity="high",
                category="technical",
                title=f"Contexte saturé en fin de conversation ({context_used:,.0f} / {llm.context_window:,})",
                detail=(
                    "Au-delà de 70 % de la fenêtre, la troncature agressive coupe des messages "
                    "utiles et dégrade la qualité de réponse."
                ),
                mitigation=(
                    "Ajouter une stratégie de résumé (sliding window + recap toutes les N turns) ou "
                    "basculer sur un modèle avec un contexte plus large (Nova Pro : 300k)."
                ),
                owner="engineering",
                time_horizon="before_launch",
            )
        )

    # ─── Architecture — multi-agent complexity ────────────────────────────
    if inputs.agents_count >= 5:
        risks.append(
            Risk(
                severity="medium",
                category="architecture",
                title=f"{inputs.agents_count} agents = complexité opérationnelle",
                detail=(
                    "Au-delà de 4-5 agents spécialisés, le traçage des décisions et la "
                    "reproductibilité des bugs deviennent coûteux."
                ),
                mitigation=(
                    "Investir dans un orchestrateur explicite (LangGraph state machine ou "
                    "Step Functions) + Langfuse pour la trace complète."
                ),
                owner="engineering",
                time_horizon="before_launch",
            )
        )

    # ─── Cost optim — RAG mis-tuned ───────────────────────────────────────
    if inputs.avg_input_tokens_per_turn > 20_000:
        risks.append(
            Risk(
                severity="medium",
                category="cost_optim",
                title="Input tokens/turn très élevé (>20 k)",
                detail=(
                    "Symptomatique d'un RAG qui remonte trop de chunks (k>10) ou d'un system "
                    "prompt trop verbeux. Diminuer de moitié divise le coût input par deux."
                ),
                mitigation=(
                    "Instrumenter la longueur du contexte réel/turn (Langfuse) et itérer sur "
                    "le retriever : réduire k, activer le reranking, résumer les long chunks."
                ),
                owner="engineering",
                time_horizon="first_month",
                estimated_impact_usd=round(cost.llm_input * 0.5, 0),
            )
        )

    # ─── Vendor lock-in ───────────────────────────────────────────────────
    if inputs.deployment in ("anthropic_api", "openai_api") and cost.total_monthly > 5_000:
        risks.append(
            Risk(
                severity="medium",
                category="vendor_lockin",
                title=f"Dépendance directe à {inputs.deployment} pour >5k USD/mois",
                detail=(
                    "L'API directe (Anthropic / OpenAI) n'offre pas les mêmes engagements "
                    "contractuels que Bedrock ou Azure OpenAI (DPA, région EU, SOC 2 avancé). "
                    "Un incident vendor stoppe tout le service."
                ),
                mitigation=(
                    "Étudier un basculement sur Bedrock (Anthropic) ou Azure OpenAI et négocier "
                    "un DPA explicite avec clauses de sortie."
                ),
                owner="security",
                time_horizon="first_month",
            )
        )

    # ─── Product — very cheap model at scale ──────────────────────────────
    if (
        inputs.llm_id in ("gpt-4o-mini", "claude-haiku-4-5")
        and inputs.avg_turns_per_interaction >= 5
    ):
        risks.append(
            Risk(
                severity="low",
                category="product",
                title="Modèle bas-coût sur conversations longues",
                detail=(
                    "Les modèles ultra-compétitifs dégradent sur les conversations multi-turn "
                    "avec reasoning cumulatif. L'utilisateur risque des réponses incohérentes "
                    "vers le turn 5+."
                ),
                mitigation=(
                    "Prévoir un router qui bascule automatiquement sur Sonnet à partir du turn 3, "
                    "et instrumenter la satisfaction utilisateur (thumbs up/down)."
                ),
                owner="product",
                time_horizon="first_month",
            )
        )

    # ─── Operational — tools dominate cost ────────────────────────────────
    llm_total = cost.llm_input + cost.llm_output
    if cost.tools > llm_total and cost.tools > 500:
        risks.append(
            Risk(
                severity="medium",
                category="operational",
                title="Coût des tools > coût LLM",
                detail=(
                    f"{cost.tools:,.0f} USD/mois de tool calls vs {llm_total:,.0f} USD LLM. "
                    "Symptôme classique d'un agent qui abuse d'un outil (web search en boucle, "
                    "OCR sur chaque doc au lieu du cache)."
                ),
                mitigation=(
                    "Auditer 20 traces sur Langfuse pour identifier le pattern d'usage. Mettre "
                    "en cache les résultats déterministes (web search sur les mêmes queries)."
                ),
                owner="engineering",
                time_horizon="first_month",
                estimated_impact_usd=round(cost.tools * 0.4, 0),
            )
        )

    # ─── Security — code execution + no sandbox mention ───────────────────
    if "code_exec" in inputs.tool_ids:
        risks.append(
            Risk(
                severity="high",
                category="security",
                title="Exécution de code généré par le modèle",
                detail=(
                    "Le tool code_exec expose la surface d'attaque la plus large : un prompt "
                    "injecté peut exfiltrer credentials, lancer des requêtes vers l'IMDS, "
                    "ou consommer du CPU sans limite."
                ),
                mitigation=(
                    "Isolation stricte : Firecracker ou Bedrock CodeInterpreter, network egress OFF, "
                    "quota CPU/temps hard, filesystem éphémère, pas d'IAM role attaché au sandbox."
                ),
                owner="security",
                time_horizon="before_launch",
                references=["Bedrock CodeInterpreter isolation", "Firecracker MicroVM"],
            )
        )

    # ─── Baseline missing ─────────────────────────────────────────────────
    if baseline.source != "ingested_data":
        risks.append(
            Risk(
                severity="info",
                category="baseline",
                title="Pas de baseline FinOps disponible",
                detail=(
                    "Aucune donnée cloud actuellement ingérée : impossible de calculer le delta "
                    "vs. facture existante. La projection reste absolue."
                ),
                mitigation="Ingérer un mois de facturation via /api/events ou /api/gcp/sync avant la revue.",
                owner="finops",
                time_horizon="before_launch",
            )
        )

    if not risks or all(r.severity == "info" for r in risks):
        risks.append(
            Risk(
                severity="info",
                category="baseline",
                title="Configuration cohérente — aucun risque bloquant détecté",
                detail=(
                    "Les paramètres actuels ne déclenchent aucune règle. Repasser l'analyse "
                    "quand les hypothèses bougent (MAU, modèle, tools)."
                ),
                mitigation="Refaire tourner l'estimation à chaque changement majeur d'hypothèse.",
                owner="product",
                time_horizon="ongoing",
            )
        )

    # Order: severity desc, then category alpha for readability.
    severity_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    risks.sort(key=lambda r: (severity_rank[r.severity], r.category))
    return risks


# ---------------------------------------------------------------------------
# Analysis axes — structured follow-up analyses
# ---------------------------------------------------------------------------


def _suggested_axes(inputs: SimulationInputs, cost: CostBreakdown) -> list[AnalysisAxis]:
    """Return the follow-up analyses to run after the workshop.

    Structured (title + rationale + how_to) so a delivery lead can hand each
    axis to an analyst without translation — every axis includes what to
    measure and how to measure it.
    """
    axes: list[AnalysisAxis] = [
        AnalysisAxis(
            title="Sensibilité au volume utilisateurs (±30 % MAU)",
            rationale=(
                "Les hypothèses d'adoption sont la principale source d'incertitude sur le coût "
                "projeté. Cartographier la courbe permet d'identifier les paliers où l'architecture "
                "doit évoluer (cache, queue, multi-region)."
            ),
            how_to=(
                "Relancer trois simulations avec MAU × 0,7 / × 1 / × 1,3 et tracer le coût "
                "total + le point de bascule sur le coût par interaction."
            ),
            category="sensitivity",
        ),
        AnalysisAxis(
            title="Comparatif modèle : Sonnet 4.6 vs Haiku 4.5",
            rationale=(
                "L'écart de prix Sonnet/Haiku est 3x-5x mais la dégradation qualité n'est pas "
                "linéaire selon la nature de la tâche. Un benchmark ciblé tranche vite."
            ),
            how_to=(
                "Constituer 50 prompts représentatifs (5 catégories), scorer les réponses sur "
                "3 axes (exactitude, pertinence, ton) et calculer le prix par prompt gagné."
            ),
            category="quality",
        ),
        AnalysisAxis(
            title="Coût par interaction utilisateur (unit economics)",
            rationale=(
                "Passer du coût mensuel absolu au coût unitaire (par interaction / par utilisateur "
                "actif) est la clé pour arbitrer le pricing produit et détecter les segments non rentables."
            ),
            how_to=(
                "Diviser cost.total_monthly par le nombre d'interactions mensuelles projetées, "
                "puis segmenter par persona et par cas d'usage."
            ),
            category="unit_economics",
        ),
        AnalysisAxis(
            title="Latence cible utilisateur (p50 / p95)",
            rationale=(
                "La latence dicte le nombre d'agents en parallèle, le choix streaming vs batch, "
                "et l'appétence à activer les guardrails/routes secondaires."
            ),
            how_to=(
                "Fixer un SLO produit (ex : p95 < 4 s pour un chat, p95 < 15 s pour un pipeline "
                "documentaire) et cascader sur les décisions d'architecture."
            ),
            category="ops",
        ),
    ]

    if cost.tools > cost.llm_input + cost.llm_output:
        axes.append(
            AnalysisAxis(
                title="Rentabilité des tools activés",
                rationale=(
                    f"Coût tools ({cost.tools:,.0f} USD/mois) supérieur au coût LLM "
                    f"({cost.llm_input + cost.llm_output:,.0f} USD/mois) : au moins un tool est "
                    "sur-sollicité ou candidat à un cache/pré-calcul."
                ),
                how_to=(
                    "Instrumenter Langfuse par tool_id sur 100 traces, calculer le taux de "
                    "réutilisation (mêmes arguments = mêmes résultats) et le taux de valeur ajoutée."
                ),
                category="ops",
            )
        )

    if inputs.monthly_active_users >= 500:
        axes.append(
            AnalysisAxis(
                title="Simulation du pic mensuel (2x moyenne)",
                rationale=(
                    "Un agent grand public suit typiquement une distribution horaire non-uniforme. "
                    "Dimensionner sur la moyenne condamne l'expérience aux heures de pointe."
                ),
                how_to=(
                    "Répliquer la simulation avec MAU × 2 sur 3 jours consécutifs, mesurer la "
                    "capacité (Bedrock throughput, taille worker pool) et budgéter l'over-provisioning."
                ),
                category="sensitivity",
            )
        )

    if inputs.deployment in ("anthropic_api", "openai_api"):
        axes.append(
            AnalysisAxis(
                title="Comparatif déploiement : API directe vs cloud provider",
                rationale=(
                    "Les APIs directes offrent souvent un tarif légèrement inférieur mais des "
                    "garanties (DPA, région EU, SOC 2 Type II) parfois insuffisantes pour un usage entreprise."
                ),
                how_to=(
                    "Cadrer un tableau de décision Compliance × Latence × Coût × Résilience "
                    "avec pondération à valider par le Legal + Security."
                ),
                category="commercial",
            )
        )

    axes.append(
        AnalysisAxis(
            title="Business case chiffré sur 12 mois",
            rationale=(
                "Le coût seul ne suffit pas à cadrer un projet agentique. Confronter à la valeur "
                "générée (temps gagné, CSAT, deals accélérés) est indispensable pour la revue exécutive."
            ),
            how_to=(
                "Estimer un ROI conservateur (ex : X heures/mois évitées × taux horaire moyen) "
                "et comparer au coût 12 mois cumulé de la présente simulation."
            ),
            category="commercial",
        )
    )

    return axes


# ---------------------------------------------------------------------------
# Executive summary — pre-baked exec framing for the top of the deck
# ---------------------------------------------------------------------------


def _executive_summary(
    inputs: SimulationInputs, cost: CostBreakdown, baseline: BaselineContext, delta_pct: float
) -> ExecutiveSummary:
    """Compile the one-glance framing served at the top of the scoping deck.

    The strings are deterministic; every UI decision (color-coding, verbosity)
    happens client-side. Confidence is derived from how anchored the numbers
    are on real data — a missing baseline or extreme token estimates drop it.
    """
    breakdown = {
        "llm_input": cost.llm_input,
        "llm_output": cost.llm_output,
        "tools": cost.tools,
        "infrastructure": cost.infrastructure,
    }
    dominant_key = max(breakdown, key=lambda k: breakdown[k])
    dominant_pct = (
        breakdown[dominant_key] / cost.total_monthly * 100 if cost.total_monthly > 0 else 0.0
    )

    interactions_per_month = inputs.monthly_active_users * inputs.interactions_per_user_per_month
    unit_per_interaction = (
        cost.total_monthly / interactions_per_month if interactions_per_month > 0 else 0.0
    )
    unit_per_user = (
        cost.total_monthly / inputs.monthly_active_users if inputs.monthly_active_users > 0 else 0.0
    )

    # Confidence heuristic.
    confidence: Literal["low", "medium", "high"] = "medium"
    confidence_notes: list[str] = []
    if baseline.source == "ingested_data":
        confidence = "high"
        confidence_notes.append("Baseline calibrée sur la facturation cloud réellement ingérée.")
    else:
        confidence = "low"
        confidence_notes.append(
            "Pas de baseline FinOps disponible — le delta vs. existant est indicatif."
        )
    if inputs.avg_input_tokens_per_turn > 20_000:
        confidence = "low"
        confidence_notes.append(
            "Input tokens/turn > 20k : suggestive d'un RAG mal dimensionné, coût réel probablement inférieur si le retriever est optimisé."
        )
    if inputs.avg_output_tokens_per_turn > 4_000:
        confidence_notes.append(
            "Output tokens/turn > 4k : reste plausible mais rare — vérifier la longueur cible des réponses avec le product."
        )

    # Headline framing.
    total_annual = cost.total_monthly * 12
    if cost.total_monthly < 500:
        size_tag = "POC / preuve de concept"
    elif cost.total_monthly < 5_000:
        size_tag = "projet piloté"
    elif cost.total_monthly < 25_000:
        size_tag = "production à échelle départementale"
    else:
        size_tag = "programme entreprise"

    headline = (
        f"Projet {inputs.project_name.strip() or 'agentique'} — {size_tag} : "
        f"{cost.total_monthly:,.0f} USD/mois (~{total_annual:,.0f} USD/an), "
        f"dominé par {dominant_key.replace('_', ' ')} ({dominant_pct:.0f} %)."
    )

    return ExecutiveSummary(
        headline=headline,
        monthly_bill_usd=round(cost.total_monthly, 2),
        annual_bill_usd=round(total_annual, 2),
        delta_vs_baseline_pct=round(delta_pct, 1),
        dominant_cost_driver=dominant_key,  # type: ignore[arg-type]
        dominant_cost_driver_pct=round(dominant_pct, 1),
        unit_cost_per_interaction_usd=round(unit_per_interaction, 4),
        unit_cost_per_user_usd=round(unit_per_user, 4),
        confidence=confidence,
        confidence_notes=confidence_notes,
    )


# ---------------------------------------------------------------------------
# Forward monthly events for the FinOps model
# ---------------------------------------------------------------------------


def _projected_events(inputs: SimulationInputs, cost: CostBreakdown) -> list[dict]:
    """12 forward-looking months spread across DAILY events.

    Previously the projection emitted one row per month (48 rows total for
    12 months × 4 components). Downstream analytics choke on that: STL needs
    ≥ 14 daily points, stationarity/skew/PCA all misbehave on <15 rows or
    quasi-constant signals — that's why /api/stl, /api/stl/strengths and
    /api/stationarity returned 400 immediately after a push.

    Fix: still emit the same monthly totals, but distribute each month's
    amount evenly across every day of that month. The FinOps forecast module
    smooths on top, so we don't introduce artificial daily noise — but the
    series is now dense enough (≈365 rows/component) for every downstream
    diagnostic to run cleanly.
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

    def _add_months(anchor: date, months: int) -> date:
        """First day of the month ``months`` after anchor's month.

        True calendar-month arithmetic: the previous 30-day stepping did not
        land on 12 distinct months (run on Feb 1st, July appeared twice and
        one month was skipped entirely — the duplicated month's events were
        emitted twice, doubling its projected cost downstream).
        """
        total = anchor.year * 12 + (anchor.month - 1) + months
        return date(total // 12, total % 12 + 1, 1)

    def _month_span(anchor: date) -> tuple[date, int]:
        """Return (first_day, days_in_month) for the month containing anchor."""
        first = anchor.replace(day=1)
        last_day = _add_months(first, 1) - timedelta(days=1)
        return first, last_day.day

    for month_offset in range(12):
        # 12 consecutive calendar months, starting with the month after today.
        first_day, days_in_month = _month_span(_add_months(today, month_offset + 1))
        for service, monthly_amount in per_component:
            if monthly_amount <= 0:
                continue
            # Distribute the monthly cost evenly across every day of the
            # month. Rounding on the daily amount + a residual on the last day
            # preserves the exact monthly total.
            daily_amount = round(monthly_amount / days_in_month, 4)
            spent = 0.0
            for d in range(days_in_month):
                dt = first_day + timedelta(days=d)
                # Absorb rounding drift into the last day so sum == monthly.
                amount = daily_amount
                if d == days_in_month - 1:
                    amount = round(monthly_amount - spent, 4)
                spent += amount
                events.append(
                    {
                        "date": dt.isoformat(),
                        "service": service,
                        "cost": round(amount, 4),
                        "description": f"Projected cost — {description_suffix}",
                    }
                )
    return events


# ---------------------------------------------------------------------------
# Public entry-point
# ---------------------------------------------------------------------------


def simulate(inputs: SimulationInputs) -> SimulationResult:
    baseline = _current_baseline()
    cost = _estimate_cost(inputs)
    delta_pct = (
        (cost.total_monthly / baseline.monthly_avg) * 100 if baseline.monthly_avg > 0 else 0.0
    )
    return SimulationResult(
        inputs=inputs,
        baseline=baseline,
        cost=cost,
        projected_monthly_events=_projected_events(inputs, cost),
        delta_vs_baseline_pct=round(delta_pct, 1),
        executive_summary=_executive_summary(inputs, cost, baseline, delta_pct),
        architecture=_recommend_architecture(inputs),
        risks=_assess_risks(inputs, cost, baseline),
        analysis_axes=_suggested_axes(inputs, cost),
    )

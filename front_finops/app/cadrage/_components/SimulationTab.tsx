"use client"

import { useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Compass,
  Info,
  Lightbulb,
  ShieldAlert,
  Target,
  Wrench,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SectionCard } from "@/components/ui/section-card"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { ErrorBanner, SuccessBanner, extractMessage } from "@/components/ui/banners"

// Tab 5 — Agentic scoping simulator
// ---------------------------------------------------------------------------

interface LLMEntry {
  id: string
  label: string
  vendor: string
  provider: string
  inputPerMillion: number
  outputPerMillion: number
  contextWindow: number
  notes?: string
}
interface ToolEntry { id: string; label: string; unitCost: number; description: string }
interface DeploymentEntry { id: string; label: string; base_infra_usd?: number }

interface ReferenceCatalog {
  llms: LLMEntry[]
  tools: ToolEntry[]
  deploymentTargets: DeploymentEntry[]
}

type RiskSeverity = "info" | "low" | "medium" | "high" | "critical"
type ArchPhase = "mvp" | "scale" | "hardening"
type ArchPriority = "must_have" | "recommended" | "nice_to_have"
type ArchImpact =
  | "cost"
  | "latency"
  | "security"
  | "reliability"
  | "observability"
  | "quality"
  | "compliance"
type ArchEffort = "S" | "M" | "L"

interface Architecture {
  component: string
  reason: string
  priority: ArchPriority
  impact: ArchImpact
  effort: ArchEffort
  phase: ArchPhase
  estCostDeltaPct?: number | null
  references: string[]
}

interface RiskItem {
  severity: RiskSeverity
  category: string
  title: string
  detail: string
  mitigation?: string | null
  owner?: string | null
  timeHorizon?: "before_launch" | "first_month" | "ongoing" | null
  estimatedImpactUsd?: number | null
  references: string[]
}

interface AnalysisAxisItem {
  title: string
  rationale: string
  howTo: string
  category: "sensitivity" | "unit_economics" | "quality" | "ops" | "commercial"
}

interface ExecutiveSummary {
  headline: string
  monthlyBillUsd: number
  annualBillUsd: number
  deltaVsBaselinePct: number
  dominantCostDriver: "llm_input" | "llm_output" | "tools" | "infrastructure"
  dominantCostDriverPct: number
  unitCostPerInteractionUsd: number
  unitCostPerUserUsd: number
  confidence: "low" | "medium" | "high"
  confidenceNotes: string[]
}

interface SimResult {
  cost: {
    llmInput: number
    llmOutput: number
    tools: number
    infrastructure: number
    totalMonthly: number
    currency: string
  }
  baseline: {
    monthlyAvg: number
    periodStart: string | null
    periodEnd: string | null
    topService: string | null
    source: string
  }
  projectedMonthlyEvents: { date: string; service: string; cost: number; description: string }[]
  deltaVsBaselinePct: number
  executiveSummary: ExecutiveSummary
  architecture: Architecture[]
  risks: RiskItem[]
  analysisAxes: AnalysisAxisItem[]
}

interface SimInputs {
  projectName: string
  monthlyActiveUsers: number
  interactionsPerUserPerMonth: number
  agentsCount: number
  avgTurnsPerInteraction: number
  llmId: string
  toolIds: string[]
  avgInputTokensPerTurn: number
  avgOutputTokensPerTurn: number
  deployment: string
  hasGuardrails: boolean
  hasCaching: boolean
}

function toSnake(inputs: SimInputs) {
  return {
    project_name: inputs.projectName,
    monthly_active_users: inputs.monthlyActiveUsers,
    interactions_per_user_per_month: inputs.interactionsPerUserPerMonth,
    agents_count: inputs.agentsCount,
    avg_turns_per_interaction: inputs.avgTurnsPerInteraction,
    llm_id: inputs.llmId,
    tool_ids: inputs.toolIds,
    avg_input_tokens_per_turn: inputs.avgInputTokensPerTurn,
    avg_output_tokens_per_turn: inputs.avgOutputTokensPerTurn,
    deployment: inputs.deployment,
    has_guardrails: inputs.hasGuardrails,
    has_caching: inputs.hasCaching,
  }
}

function useSimReference() {
  return useQuery<ReferenceCatalog>({
    queryKey: ["sim-reference"],
    queryFn: () => api.get("/api/simulation/reference").then((r) => r.data),
    staleTime: Infinity,
  })
}

function useSimEstimate() {
  return useMutation<SimResult, Error, SimInputs>({
    mutationFn: (inputs) =>
      api.post("/api/simulation/estimate", toSnake(inputs)).then((r) => r.data),
  })
}

function useSimPush() {
  return useMutation<
    { ingested: number; projectName: string; periodStart: string; periodEnd: string },
    Error,
    { events: SimResult["projectedMonthlyEvents"]; projectName: string }
  >({
    mutationFn: ({ events, projectName }) =>
      api
        .post("/api/simulation/push", {
          events: events.map((e) => ({
            date: e.date,
            service: e.service,
            cost: e.cost,
            description: e.description,
          })),
          project_name: projectName,
        })
        .then((r) => r.data),
  })
}

// ─── Cosmetics tables ────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<
  RiskSeverity,
  { badge: "muted" | "warning" | "destructive" | "default" | "success"; ring: string; label: string }
> = {
  info: { badge: "muted", ring: "border-border", label: "Info" },
  low: { badge: "muted", ring: "border-border", label: "Faible" },
  medium: { badge: "warning", ring: "border-[color:var(--warning)]/50", label: "Moyen" },
  high: { badge: "destructive", ring: "border-destructive/50", label: "Élevé" },
  critical: { badge: "destructive", ring: "border-destructive/70", label: "Critique" },
}

const PHASE_META: Record<ArchPhase, { label: string; description: string; icon: React.ReactNode }> = {
  mvp: {
    label: "Phase 1 · MVP",
    description: "Fondations indispensables pour un premier go-live contrôlé.",
    icon: <Target className="h-3.5 w-3.5" aria-hidden />,
  },
  scale: {
    label: "Phase 2 · Scale",
    description: "À déployer dès que l'usage dépasse le seuil de tolérance MVP.",
    icon: <Compass className="h-3.5 w-3.5" aria-hidden />,
  },
  hardening: {
    label: "Phase 3 · Hardening",
    description: "Sécurité, observabilité, qualité — non négociable pour la prod.",
    icon: <ShieldAlert className="h-3.5 w-3.5" aria-hidden />,
  },
}

const PRIORITY_META: Record<ArchPriority, { label: string; variant: "destructive" | "warning" | "muted" }> = {
  must_have: { label: "Must-have", variant: "destructive" },
  recommended: { label: "Recommandé", variant: "warning" },
  nice_to_have: { label: "Nice-to-have", variant: "muted" },
}

const IMPACT_LABELS: Record<ArchImpact, string> = {
  cost: "Coût",
  latency: "Latence",
  security: "Sécurité",
  reliability: "Fiabilité",
  observability: "Observabilité",
  quality: "Qualité",
  compliance: "Conformité",
}

const EFFORT_LABELS: Record<ArchEffort, string> = {
  S: "S · 1-3 j",
  M: "M · 1-2 sem.",
  L: "L · > 2 sem.",
}

const TIME_HORIZON_LABELS: Record<"before_launch" | "first_month" | "ongoing", string> = {
  before_launch: "Avant go-live",
  first_month: "1er mois",
  ongoing: "Continu",
}

const AXIS_CATEGORY_META: Record<
  AnalysisAxisItem["category"],
  { label: string; icon: React.ReactNode }
> = {
  sensitivity: { label: "Sensibilité", icon: <Compass className="h-3 w-3" aria-hidden /> },
  unit_economics: { label: "Unit economics", icon: <Target className="h-3 w-3" aria-hidden /> },
  quality: { label: "Qualité", icon: <Lightbulb className="h-3 w-3" aria-hidden /> },
  ops: { label: "Ops", icon: <Wrench className="h-3 w-3" aria-hidden /> },
  commercial: { label: "Commercial", icon: <Info className="h-3 w-3" aria-hidden /> },
}

const CONFIDENCE_META: Record<
  "low" | "medium" | "high",
  { label: string; variant: "destructive" | "warning" | "success"; description: string }
> = {
  low: {
    label: "Confiance faible",
    variant: "destructive",
    description: "Numéros indicatifs — trop d'hypothèses non ancrées sur des données réelles.",
  },
  medium: {
    label: "Confiance moyenne",
    variant: "warning",
    description: "Estimation utile pour cadrer ; à réajuster une fois la baseline mesurée.",
  },
  high: {
    label: "Confiance élevée",
    variant: "success",
    description: "Cadrage aligné sur la facturation ingérée — solide pour une revue exécutive.",
  },
}

const DOMINANT_LABELS: Record<ExecutiveSummary["dominantCostDriver"], string> = {
  llm_input: "input LLM",
  llm_output: "output LLM",
  tools: "tools",
  infrastructure: "infrastructure",
}

function formatUsd(n: number, opts: Intl.NumberFormatOptions = {}) {
  return `$${n.toLocaleString("fr-FR", { maximumFractionDigits: 0, ...opts })}`
}

function countBy<T, K extends string | number>(arr: T[], keyFn: (t: T) => K): Record<K, number> {
  const out = {} as Record<K, number>
  for (const item of arr) {
    const k = keyFn(item)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

export function SimulationTab() {
  const queryClient = useQueryClient()
  const { data: catalog } = useSimReference()
  const { mutate: estimate, data: result, isPending: estimating, error: estimateError } = useSimEstimate()
  const { mutate: push, isPending: pushing, isSuccess: pushed, data: pushData, error: pushError, reset: resetPush } = useSimPush()

  const [inputs, setInputs] = useState<SimInputs>({
    projectName: "POC agent",
    monthlyActiveUsers: 500,
    interactionsPerUserPerMonth: 10,
    agentsCount: 2,
    avgTurnsPerInteraction: 3,
    llmId: "claude-sonnet-4-6",
    toolIds: ["rag_retrieval"],
    avgInputTokensPerTurn: 2000,
    avgOutputTokensPerTurn: 400,
    deployment: "bedrock",
    hasGuardrails: false,
    hasCaching: false,
  })

  function update<K extends keyof SimInputs>(key: K, value: SimInputs[K]) {
    setInputs((s) => ({ ...s, [key]: value }))
    resetPush()
  }

  function toggleTool(id: string) {
    setInputs((s) => ({
      ...s,
      toolIds: s.toolIds.includes(id) ? s.toolIds.filter((t) => t !== id) : [...s.toolIds, id],
    }))
    resetPush()
  }

  function handleEstimate() {
    if (!catalog) return
    estimate(inputs)
  }

  function handlePush() {
    if (!result) return
    push(
      { events: result.projectedMonthlyEvents, projectName: inputs.projectName },
      {
        // The pushed events land in the same in-memory store as /api/events, so
        // invalidate everything (KPI, daily, services, forecast, analytics,
        // diagnostics) to make the projection visible across the app.
        onSuccess: () => {
          void queryClient.invalidateQueries()
        },
      },
    )
  }

  return (
    <SectionCard
      title="Cadrage d'un projet agentique"
      description="Réponds aux questions de scoping et compare la projection au baseline FinOps. Le résultat peut être poussé dans le modèle pour alimenter la prévision."
      accent="green"
      contentClassName="space-y-5"
    >
      {/* --- Form: scoping questions ------------------------------------ */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Nom du projet
          </label>
          <input
            type="text"
            value={inputs.projectName}
            onChange={(e) => update("projectName", e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Modèle LLM
          </label>
          <select
            value={inputs.llmId}
            onChange={(e) => update("llmId", e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            {catalog?.llms.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label} — {l.vendor} · ${l.inputPerMillion}/${l.outputPerMillion} par 1M
              </option>
            ))}
          </select>
        </div>

        <NumberField
          label="Utilisateurs actifs / mois"
          value={inputs.monthlyActiveUsers}
          onChange={(v) => update("monthlyActiveUsers", v)}
          min={1}
          max={10_000_000}
          step={100}
        />
        <NumberField
          label="Interactions / user / mois"
          value={inputs.interactionsPerUserPerMonth}
          onChange={(v) => update("interactionsPerUserPerMonth", v)}
          min={1}
          max={100_000}
          step={1}
        />
        <NumberField
          label="Nombre d'agents spécialisés"
          value={inputs.agentsCount}
          onChange={(v) => update("agentsCount", v)}
          min={1}
          max={100}
          step={1}
        />
        <NumberField
          label="Tours moyens / interaction"
          value={inputs.avgTurnsPerInteraction}
          onChange={(v) => update("avgTurnsPerInteraction", v)}
          min={1}
          max={50}
          step={0.5}
          decimals={1}
        />
        <NumberField
          label="Input tokens / tour (contexte moyen)"
          value={inputs.avgInputTokensPerTurn}
          onChange={(v) => update("avgInputTokensPerTurn", v)}
          min={100}
          max={200_000}
          step={100}
        />
        <NumberField
          label="Output tokens / tour"
          value={inputs.avgOutputTokensPerTurn}
          onChange={(v) => update("avgOutputTokensPerTurn", v)}
          min={10}
          max={100_000}
          step={50}
        />

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cible de déploiement
          </label>
          <select
            value={inputs.deployment}
            onChange={(e) => update("deployment", e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
          >
            {catalog?.deploymentTargets.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-4 items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inputs.hasGuardrails}
              onChange={(e) => update("hasGuardrails", e.target.checked)}
              className="h-4 w-4 rounded border-border accent-[color:var(--accent-green)]"
            />
            <span>Guardrails PII / prompt-injection</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={inputs.hasCaching}
              onChange={(e) => update("hasCaching", e.target.checked)}
              className="h-4 w-4 rounded border-border accent-[color:var(--accent-green)]"
            />
            <span>Prompt caching (Bedrock/OpenAI)</span>
          </label>
        </div>
      </div>

      {/* Tools */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tools activés
        </label>
        <div className="flex flex-wrap gap-2">
          {catalog?.tools.map((t) => {
            const active = inputs.toolIds.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTool(t.id)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "border-[color:var(--accent-green)] bg-[color:var(--accent-green)]/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-[color:var(--accent-green)]/40",
                )}
                title={t.description}
              >
                <span className="font-medium">{t.label}</span>
                <span className="ml-2 text-[10px] opacity-70">${t.unitCost}/call</span>
              </button>
            )
          })}
        </div>
      </div>

      <Button onClick={handleEstimate} disabled={estimating || !catalog}>
        {estimating ? "Estimation…" : "Lancer l'estimation"}
      </Button>
      {estimateError && <ErrorBanner message="L'estimation a échoué. Vérifie que le backend est démarré." />}

      {/* --- Result ----------------------------------------------------- */}
      {result && (
        <div className="space-y-6">
          <ExecutiveSummaryCard summary={result.executiveSummary} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Coût mensuel projeté"
              value={formatUsd(result.cost.totalMonthly)}
              hint={`sur 12 mois : ${formatUsd(result.cost.totalMonthly * 12)}`}
              accent
            />
            <StatCard
              label="Coût / interaction"
              value={
                result.executiveSummary.unitCostPerInteractionUsd > 0
                  ? `$${result.executiveSummary.unitCostPerInteractionUsd.toFixed(4)}`
                  : "—"
              }
              hint={`$${result.executiveSummary.unitCostPerUserUsd.toFixed(2)}/user actif`}
            />
            <StatCard
              label="Impact sur la facture"
              value={
                result.baseline.monthlyAvg > 0
                  ? `${result.deltaVsBaselinePct > 0 ? "+" : ""}${result.deltaVsBaselinePct.toFixed(1)}%`
                  : "N/A"
              }
              hint={
                result.baseline.source === "ingested_data"
                  ? `vs baseline ${formatUsd(result.baseline.monthlyAvg)}`
                  : "Pas de baseline ingérée"
              }
            />
            <StatCard
              label="Driver principal"
              value={`${DOMINANT_LABELS[result.executiveSummary.dominantCostDriver]} · ${result.executiveSummary.dominantCostDriverPct.toFixed(0)}%`}
              hint={`LLM ${((result.cost.llmInput + result.cost.llmOutput) / Math.max(result.cost.totalMonthly, 0.01) * 100).toFixed(0)}% · Tools ${(result.cost.tools / Math.max(result.cost.totalMonthly, 0.01) * 100).toFixed(0)}% · Infra ${(result.cost.infrastructure / Math.max(result.cost.totalMonthly, 0.01) * 100).toFixed(0)}%`}
            />
          </div>

          <CostBreakdownBar cost={result.cost} />

          <ArchitectureSection recommendations={result.architecture} />

          <RisksSection risks={result.risks} />

          <AnalysisAxesSection axes={result.analysisAxes} />

          {/* Push to FinOps */}
          <div className="rounded-xl border border-[color:var(--accent-green)]/30 bg-[color:var(--accent-green)]/5 p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Injecter la projection dans le modèle FinOps</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ajoute {result.projectedMonthlyEvents.length} événements (12 mois × {new Set(result.projectedMonthlyEvents.map((e) => e.service)).size} composants) au store actuel (mode append).
              </p>
            </div>
            {pushed && pushData && (
              <SuccessBanner message={`${pushData.ingested.toLocaleString("fr-FR")} événements ingérés. Période mise à jour: ${pushData.periodStart} → ${pushData.periodEnd}. Toutes les pages sont à jour.`} />
            )}
            {pushError && (
              <ErrorBanner
                message={extractMessage(pushError) ?? "Push refusé par le backend."}
              />
            )}
            <Button onClick={handlePush} disabled={pushing || pushed}>
              {pushing ? "Injection…" : pushed ? "Injecté" : "Pousser vers le modèle FinOps"}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Executive summary card — headline + confidence + narrative bullets
// ---------------------------------------------------------------------------
function ExecutiveSummaryCard({ summary }: { summary: ExecutiveSummary }) {
  const conf = CONFIDENCE_META[summary.confidence]
  return (
    <div className="rounded-2xl border border-[color:var(--accent-green)]/30 bg-gradient-to-br from-[color:var(--accent-green)]/8 to-transparent p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--accent-green)]">
          <Target className="h-3.5 w-3.5" aria-hidden />
          Synthèse exécutive
        </div>
        <Badge variant={conf.variant} size="sm" title={conf.description}>
          {conf.label}
        </Badge>
      </div>
      <p className="text-[15px] leading-relaxed font-medium text-foreground">
        {summary.headline}
      </p>
      <div className="grid gap-3 sm:grid-cols-3 pt-1">
        <MicroStat
          label="Bill annuel projeté"
          value={formatUsd(summary.annualBillUsd)}
        />
        <MicroStat
          label="Coût / interaction"
          value={summary.unitCostPerInteractionUsd > 0 ? `$${summary.unitCostPerInteractionUsd.toFixed(4)}` : "—"}
        />
        <MicroStat
          label="Coût / utilisateur actif"
          value={summary.unitCostPerUserUsd > 0 ? `$${summary.unitCostPerUserUsd.toFixed(2)}` : "—"}
        />
      </div>
      {summary.confidenceNotes.length > 0 && (
        <ul className="text-[11px] text-muted-foreground space-y-1 border-t border-border/60 pt-2 mt-1">
          {summary.confidenceNotes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <Info className="h-3 w-3 mt-0.5 shrink-0 opacity-70" aria-hidden />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MicroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="mt-0.5 font-heading text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cost breakdown — stacked horizontal bar with legend
// ---------------------------------------------------------------------------
function CostBreakdownBar({ cost }: { cost: SimResult["cost"] }) {
  const total = Math.max(cost.totalMonthly, 0.01)
  const segments = [
    { key: "llm_input", label: "Input LLM", value: cost.llmInput, color: "bg-[color:var(--brand)]" },
    { key: "llm_output", label: "Output LLM", value: cost.llmOutput, color: "bg-[color:var(--accent-green)]" },
    { key: "tools", label: "Tools", value: cost.tools, color: "bg-[color:var(--warning)]" },
    { key: "infrastructure", label: "Infra", value: cost.infrastructure, color: "bg-muted-foreground/70" },
  ]
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Compass className="h-3.5 w-3.5" aria-hidden />
        Répartition du coût mensuel
      </p>
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-border">
        {segments.map((s) => {
          const pct = (s.value / total) * 100
          if (pct <= 0) return null
          return (
            <div
              key={s.key}
              className={cn(s.color, "transition-all")}
              style={{ width: `${pct}%` }}
              title={`${s.label} · ${formatUsd(s.value)} (${pct.toFixed(1)}%)`}
            />
          )
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
        {segments.map((s) => {
          const pct = (s.value / total) * 100
          return (
            <div key={s.key} className="flex items-center gap-2">
              <span className={cn(s.color, "h-2.5 w-2.5 rounded-full shrink-0")} aria-hidden />
              <span className="text-muted-foreground">{s.label}</span>
              <span className="ml-auto tabular-nums font-medium">
                {formatUsd(s.value)} · {pct.toFixed(0)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Architecture recommendations — grouped by phase, with priority + effort
// ---------------------------------------------------------------------------
function ArchitectureSection({ recommendations }: { recommendations: Architecture[] }) {
  const byPhase: Record<ArchPhase, Architecture[]> = {
    mvp: recommendations.filter((r) => r.phase === "mvp"),
    scale: recommendations.filter((r) => r.phase === "scale"),
    hardening: recommendations.filter((r) => r.phase === "hardening"),
  }
  const counts = countBy(recommendations, (r) => r.priority)
  const phases: ArchPhase[] = ["mvp", "scale", "hardening"]
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" aria-hidden />
          Architecture cible ({recommendations.length} composants)
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(["must_have", "recommended", "nice_to_have"] as ArchPriority[]).map((p) => {
            const meta = PRIORITY_META[p]
            const n = counts[p] ?? 0
            if (n === 0) return null
            return (
              <Badge key={p} variant={meta.variant} size="sm" title={meta.label}>
                {meta.label} · {n}
              </Badge>
            )
          })}
        </div>
      </div>

      {phases.map((phase) => {
        const items = byPhase[phase]
        if (items.length === 0) return null
        const meta = PHASE_META[phase]
        return (
          <div key={phase} className="space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {meta.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{meta.label}</p>
                <p className="text-[11px] text-muted-foreground">{meta.description}</p>
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {items.length}
              </span>
            </div>
            <ul className="space-y-2">
              {items.map((a, i) => (
                <li key={i} className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <p className="text-sm font-medium leading-snug">{a.component}</p>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={PRIORITY_META[a.priority].variant} size="sm">
                        {PRIORITY_META[a.priority].label}
                      </Badge>
                      <Badge variant="outline" size="sm" title="Impact principal">
                        {IMPACT_LABELS[a.impact]}
                      </Badge>
                      <Badge variant="muted" size="sm" title="Effort estimé">
                        {EFFORT_LABELS[a.effort]}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{a.reason}</p>
                  <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground pt-1">
                    {typeof a.estCostDeltaPct === "number" && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 tabular-nums",
                          a.estCostDeltaPct > 0
                            ? "text-[color:var(--warning-foreground)]"
                            : "text-[color:var(--success)]",
                        )}
                      >
                        Impact coût : {a.estCostDeltaPct > 0 ? "+" : ""}
                        {a.estCostDeltaPct.toFixed(0)}% du bill
                      </span>
                    )}
                    {a.references.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Info className="h-3 w-3" aria-hidden />
                        {a.references.join(" · ")}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Risks — severity block with mitigation callout + owner/horizon meta
// ---------------------------------------------------------------------------
function RisksSection({ risks }: { risks: RiskItem[] }) {
  const bySeverity = countBy(risks, (r) => r.severity)
  const severityOrder: RiskSeverity[] = ["critical", "high", "medium", "low", "info"]
  const totalImpact = risks.reduce((s, r) => s + (r.estimatedImpactUsd ?? 0), 0)
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
          Risques identifiés ({risks.length})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {severityOrder.map((sev) => {
            const n = bySeverity[sev] ?? 0
            if (n === 0) return null
            const meta = SEVERITY_STYLES[sev]
            return (
              <Badge key={sev} variant={meta.badge} size="sm">
                {meta.label} · {n}
              </Badge>
            )
          })}
        </div>
      </div>

      {totalImpact > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Impact financier cumulé estimé si non traité :{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatUsd(totalImpact)}/mois
          </span>{" "}
          (somme des risques quantifiés).
        </p>
      )}

      <ul className="space-y-3">
        {risks.map((r, i) => (
          <RiskRow key={i} risk={r} />
        ))}
      </ul>
    </div>
  )
}

function RiskRow({ risk }: { risk: RiskItem }) {
  const style = SEVERITY_STYLES[risk.severity]
  const SeverityIcon =
    risk.severity === "info"
      ? Info
      : risk.severity === "low" || risk.severity === "medium"
        ? AlertTriangle
        : ShieldAlert
  return (
    <li className={cn("rounded-lg border p-3.5 space-y-2.5 bg-muted/10", style.ring)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">
          <SeverityIcon
            className={cn(
              "h-4 w-4",
              risk.severity === "critical" || risk.severity === "high"
                ? "text-destructive"
                : risk.severity === "medium"
                  ? "text-[color:var(--warning-foreground)]"
                  : "text-muted-foreground",
            )}
            aria-hidden
          />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={style.badge} size="sm">
              {style.label}
            </Badge>
            <Badge variant="outline" size="sm" className="uppercase tracking-wide">
              {risk.category.replace(/_/g, " ")}
            </Badge>
            <span className="text-sm font-semibold leading-tight">{risk.title}</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{risk.detail}</p>
        </div>
      </div>

      {risk.mitigation && (
        <div className="rounded-md border border-[color:var(--accent-green)]/30 bg-[color:var(--accent-green)]/6 px-3 py-2 flex items-start gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[color:var(--accent-green)]" aria-hidden />
          <div className="text-xs leading-relaxed">
            <span className="font-semibold text-foreground">Mitigation · </span>
            <span className="text-muted-foreground">{risk.mitigation}</span>
          </div>
        </div>
      )}

      {(risk.owner || risk.timeHorizon || typeof risk.estimatedImpactUsd === "number" || risk.references.length > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-0.5">
          {risk.owner && (
            <span className="inline-flex items-center gap-1">
              <Target className="h-3 w-3" aria-hidden />
              Owner : <span className="font-medium text-foreground/80 uppercase">{risk.owner}</span>
            </span>
          )}
          {risk.timeHorizon && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden />
              {TIME_HORIZON_LABELS[risk.timeHorizon]}
            </span>
          )}
          {typeof risk.estimatedImpactUsd === "number" && risk.estimatedImpactUsd > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Impact : ~{formatUsd(risk.estimatedImpactUsd)}/mois
            </span>
          )}
          {risk.references.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Info className="h-3 w-3" aria-hidden />
              {risk.references.join(" · ")}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Analysis axes — structured cards (title + rationale + how-to)
// ---------------------------------------------------------------------------
function AnalysisAxesSection({ axes }: { axes: AnalysisAxisItem[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden />
        Axes d&apos;analyse à explorer ({axes.length})
      </p>
      <div className="grid gap-2.5 md:grid-cols-2">
        {axes.map((a, i) => {
          const meta = AXIS_CATEGORY_META[a.category]
          return (
            <div key={i} className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" size="sm" className="gap-1">
                  {meta.icon}
                  {meta.label}
                </Badge>
                <p className="text-sm font-medium leading-tight">{a.title}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{a.rationale}</p>
              <div className="text-xs leading-relaxed border-t border-border/60 pt-1.5 mt-1">
                <span className="font-semibold text-foreground">Comment mesurer · </span>
                <span className="text-muted-foreground">{a.howTo}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  decimals,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  decimals?: number
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = decimals ? parseFloat(e.target.value) : parseInt(e.target.value, 10)
          if (!Number.isNaN(n)) onChange(n)
        }}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm tabular-nums font-mono"
      />
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint: string
  accent?: boolean
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        accent ? "border-[color:var(--accent-green)]/40 bg-[color:var(--accent-green)]/5" : "border-border bg-card",
      )}
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="mt-0.5 font-heading text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>
    </div>
  )
}


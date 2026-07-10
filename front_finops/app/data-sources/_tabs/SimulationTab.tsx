"use client"

import { useState } from "react"
import { ShieldAlert, Wrench } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SectionCard } from "@/components/ui/section-card"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { ErrorBanner, SuccessBanner, extractMessage } from "./shared"

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
  architecture: { component: string; reason: string }[]
  risks: { severity: string; category: string; title: string; detail: string }[]
  analysisAxes: string[]
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

const SEVERITY_STYLES: Record<string, { badge: "muted" | "warning" | "destructive" | "default"; ring: string }> = {
  info:     { badge: "muted",       ring: "border-border" },
  low:      { badge: "muted",       ring: "border-border" },
  medium:   { badge: "warning",     ring: "border-[color:var(--warning)]/40" },
  high:     { badge: "destructive", ring: "border-destructive/40" },
  critical: { badge: "destructive", ring: "border-destructive/60" },
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
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Coût mensuel projeté"
              value={`$${result.cost.totalMonthly.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}`}
              hint={`sur 12 mois: $${(result.cost.totalMonthly * 12).toLocaleString("fr-FR", { maximumFractionDigits: 0 })}`}
              accent
            />
            <StatCard
              label="Baseline actuel"
              value={
                result.baseline.source === "ingested_data"
                  ? `$${result.baseline.monthlyAvg.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}`
                  : "—"
              }
              hint={result.baseline.source === "ingested_data" ? "Moyenne mensuelle" : "Pas de données ingérées"}
            />
            <StatCard
              label="Impact sur la facture"
              value={
                result.baseline.monthlyAvg > 0
                  ? `${result.deltaVsBaselinePct > 0 ? "+" : ""}${result.deltaVsBaselinePct.toFixed(1)}%`
                  : "N/A"
              }
              hint={result.baseline.monthlyAvg > 0 ? "vs baseline" : "—"}
            />
            <StatCard
              label="Répartition"
              value={`LLM ${((result.cost.llmInput + result.cost.llmOutput) / Math.max(result.cost.totalMonthly, 0.01) * 100).toFixed(0)}%`}
              hint={`Tools ${(result.cost.tools / Math.max(result.cost.totalMonthly, 0.01) * 100).toFixed(0)}% · Infra ${(result.cost.infrastructure / Math.max(result.cost.totalMonthly, 0.01) * 100).toFixed(0)}%`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Wrench className="h-3.5 w-3.5" aria-hidden />
                Architecture cible ({result.architecture.length} composants)
              </p>
              <ul className="space-y-2">
                {result.architecture.map((a, i) => (
                  <li key={i} className="rounded-lg border border-border bg-muted/20 p-2.5">
                    <p className="text-sm font-medium">{a.component}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.reason}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                Risques identifiés ({result.risks.length})
              </p>
              <ul className="space-y-2">
                {result.risks.map((r, i) => {
                  const style = SEVERITY_STYLES[r.severity] ?? SEVERITY_STYLES.info
                  return (
                    <li
                      key={i}
                      className={cn("rounded-lg border p-2.5", style.ring, "bg-muted/10")}
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant={style.badge} size="sm">{r.severity}</Badge>
                        <span className="text-sm font-medium">{r.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{r.detail}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Axes d&apos;analyse à explorer
            </p>
            <ul className="space-y-1 text-sm">
              {result.analysisAxes.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[color:var(--accent-green)]">•</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>

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


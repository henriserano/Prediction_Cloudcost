"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  Brain,
  Cpu,
  Info,
  Lightbulb,
  ShieldAlert,
  Sparkles,
} from "lucide-react"

import { api } from "@/lib/api"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { QueryError } from "@/components/ui/query-error"
import { cn } from "@/lib/utils"
import {
  buildRecommendations,
  CURRENT_MODEL_ID,
  projectCost,
  stripInferenceProfile,
  type LLMEntry,
  type Recommendation,
  type Volumetry,
} from "./genAIRecommendations"

// ---------------------------------------------------------------------------
// Volumetry state — persisted in localStorage so the audit survives reloads
// ---------------------------------------------------------------------------

const STORAGE_KEY = "optimiser:genai-volumetry"

const DEFAULT_VOLUMETRY: Volumetry = {
  users: 50,
  requestsPerUserPerMonth: 100,
  avgInputTokensPerTurn: 2000,
  avgOutputTokensPerTurn: 500,
}

function loadVolumetry(): Volumetry {
  if (typeof window === "undefined") return DEFAULT_VOLUMETRY
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_VOLUMETRY
    const parsed = JSON.parse(raw) as Partial<Volumetry>
    return {
      users: sanitisePositive(parsed.users, DEFAULT_VOLUMETRY.users),
      requestsPerUserPerMonth: sanitisePositive(
        parsed.requestsPerUserPerMonth,
        DEFAULT_VOLUMETRY.requestsPerUserPerMonth,
      ),
      avgInputTokensPerTurn: sanitisePositive(
        parsed.avgInputTokensPerTurn,
        DEFAULT_VOLUMETRY.avgInputTokensPerTurn,
      ),
      avgOutputTokensPerTurn: sanitisePositive(
        parsed.avgOutputTokensPerTurn,
        DEFAULT_VOLUMETRY.avgOutputTokensPerTurn,
      ),
    }
  } catch {
    return DEFAULT_VOLUMETRY
  }
}

function saveVolumetry(v: Volumetry): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
  } catch {
    // Quota exceeded / storage disabled — non-fatal.
  }
}

function sanitisePositive(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback
}

// ---------------------------------------------------------------------------
// Backend catalog
// ---------------------------------------------------------------------------

interface ReferenceCatalog {
  llms: LLMEntry[]
  tools: unknown[]
  deploymentTargets: unknown[]
}

function useLLMCatalog() {
  return useQuery<ReferenceCatalog>({
    queryKey: ["sim-reference"],
    queryFn: () => api.get("/api/simulation/reference").then((r) => r.data),
    staleTime: Infinity,
  })
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtUsd(v: number): string {
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $`
}

function fmtTokens(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} G`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)} k`
  return `${v}`
}

function fmtDelta(pct: number): { label: string; tone: "green" | "muted" | "warning" } {
  if (Math.abs(pct) < 1) return { label: "—", tone: "muted" }
  if (pct < 0) return { label: `${pct.toFixed(0)} %`, tone: "green" }
  return { label: `+${pct.toFixed(0)} %`, tone: "warning" }
}

const SEVERITY_META: Record<
  Recommendation["severity"],
  { icon: typeof Lightbulb; badge: "success" | "outline" | "warning"; label: string }
> = {
  opportunity: { icon: Lightbulb, badge: "success", label: "Opportunité" },
  info: { icon: Info, badge: "outline", label: "Info" },
  warning: { icon: ShieldAlert, badge: "warning", label: "Vigilance" },
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GenAIModelAudit() {
  const catalog = useLLMCatalog()
  const [volumetry, setVolumetry] = useState<Volumetry>(loadVolumetry)

  const updateVolumetry = (patch: Partial<Volumetry>) => {
    setVolumetry((prev) => {
      const next: Volumetry = { ...prev, ...patch }
      saveVolumetry(next)
      return next
    })
  }

  const models = useMemo<LLMEntry[]>(
    () => catalog.data?.llms ?? [],
    [catalog.data],
  )

  const projections = useMemo(
    () => models.map((m) => projectCost(m, volumetry)),
    [models, volumetry],
  )

  const current = useMemo(
    () =>
      projections.find(
        (p) => stripInferenceProfile(p.model.id) === CURRENT_MODEL_ID,
      ) ?? projections[0],
    [projections],
  )

  const cheapest = useMemo(
    () =>
      projections.length > 0
        ? [...projections].sort((a, b) => a.monthlyCostUsd - b.monthlyCostUsd)[0]
        : null,
    [projections],
  )

  const recommendations = useMemo<Recommendation[]>(() => {
    if (!current || projections.length === 0) return []
    const others = projections.filter((p) => p.model.id !== current.model.id)
    return buildRecommendations(current, others, volumetry)
  }, [current, projections, volumetry])

  // ---------------------- Loading / error branches ------------------------
  if (catalog.isPending) {
    return (
      <SectionCard title="Choix de modèles GenAI" accent="green">
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </SectionCard>
    )
  }

  if (catalog.isError) {
    return (
      <SectionCard title="Choix de modèles GenAI" accent="green">
        <QueryError
          onRetry={() => catalog.refetch()}
          description="Impossible de charger le catalogue de modèles Bedrock. Vérifiez la connexion au backend."
        />
      </SectionCard>
    )
  }

  if (models.length === 0 || !current) {
    return (
      <SectionCard title="Choix de modèles GenAI" accent="green">
        <EmptyState
          icon={Cpu}
          title="Catalogue de modèles indisponible"
          description="Le backend n'a renvoyé aucun modèle. Vérifiez l'endpoint /api/simulation/reference."
        />
      </SectionCard>
    )
  }

  return (
    <SectionCard
      title="Choix de modèles GenAI"
      description="Projection du coût mensuel Bedrock selon la volumétrie d'usage. Le modèle actuellement configuré côté serveur est mis en évidence."
      accent="green"
      action={<Badge variant="green">USD · rate cards vendeurs</Badge>}
      contentClassName="space-y-5"
    >
      {/* Volumetry inputs */}
      <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-[color:var(--accent-green)]" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Volumétrie applicative
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <VolumeInput
            label="Utilisateurs actifs / mois"
            value={volumetry.users}
            onChange={(v) => updateVolumetry({ users: v })}
          />
          <VolumeInput
            label="Requêtes / user / mois"
            value={volumetry.requestsPerUserPerMonth}
            onChange={(v) => updateVolumetry({ requestsPerUserPerMonth: v })}
          />
          <VolumeInput
            label="Tokens entrée / requête"
            value={volumetry.avgInputTokensPerTurn}
            onChange={(v) => updateVolumetry({ avgInputTokensPerTurn: v })}
          />
          <VolumeInput
            label="Tokens sortie / requête"
            value={volumetry.avgOutputTokensPerTurn}
            onChange={(v) => updateVolumetry({ avgOutputTokensPerTurn: v })}
          />
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Coût mensuel — modèle actuel"
          value={fmtUsd(current.monthlyCostUsd)}
          sub={current.model.label}
          icon={Sparkles}
          tone="green"
        />
        <KpiCard
          label="Tokens / mois"
          value={fmtTokens(
            current.monthlyInputTokens + current.monthlyOutputTokens,
          )}
          sub={`in ${fmtTokens(current.monthlyInputTokens)} · out ${fmtTokens(
            current.monthlyOutputTokens,
          )}`}
          icon={Cpu}
        />
        <KpiCard
          label="Économie max envisageable"
          value={
            cheapest && cheapest.model.id !== current.model.id
              ? fmtUsd(current.monthlyCostUsd - cheapest.monthlyCostUsd)
              : "—"
          }
          sub={
            cheapest && cheapest.model.id !== current.model.id
              ? `en basculant sur ${cheapest.model.label}`
              : "modèle actuel déjà le moins cher"
          }
          icon={Lightbulb}
          tone={
            cheapest && cheapest.model.id !== current.model.id ? "success" : "default"
          }
        />
      </div>

      {/* Comparative table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Modèle</th>
              <th className="px-3 py-2 text-left font-medium">Vendeur</th>
              <th className="px-3 py-2 text-right font-medium">$/1M in</th>
              <th className="px-3 py-2 text-right font-medium">$/1M out</th>
              <th className="px-3 py-2 text-right font-medium">Coût mensuel</th>
              <th className="px-3 py-2 text-right font-medium">Δ vs actuel</th>
              <th className="px-3 py-2 text-left font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...projections]
              .sort((a, b) => a.monthlyCostUsd - b.monthlyCostUsd)
              .map((p) => {
                const isCurrent = p.model.id === current.model.id
                const deltaPct =
                  current.monthlyCostUsd > 0
                    ? ((p.monthlyCostUsd - current.monthlyCostUsd) /
                        current.monthlyCostUsd) *
                      100
                    : 0
                const delta = fmtDelta(deltaPct)
                return (
                  <tr
                    key={p.model.id}
                    className={cn(
                      "transition-colors hover:bg-muted/20",
                      isCurrent && "bg-[color:var(--accent-green)]/6",
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {p.model.label}
                        </span>
                        {isCurrent && (
                          <Badge variant="green" className="text-[10px]">
                            Actuel
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {p.model.vendor}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      ${p.model.inputPerMillion.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      ${p.model.outputPerMillion.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">
                      {fmtUsd(p.monthlyCostUsd)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <Badge variant={delta.tone === "muted" ? "muted" : delta.tone === "green" ? "success" : "warning"} className="text-[10px]">
                        {delta.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-xs">
                      {p.model.notes ?? "—"}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Pistes d&apos;optimisation
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {recommendations.map((r) => (
              <RecommendationCard key={r.id} rec={r} />
            ))}
          </div>
        </div>
      )}

      {/* Cross-link — /cadrage stays (external page), tab-internal anchors
          are no longer needed now that Optimiser uses a tabbed nav. */}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Approfondir :</span>
        <Link href="/cadrage" className="underline underline-offset-2 hover:text-foreground">
          Cadrer un nouveau projet avec cette hypothèse
        </Link>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Tarifs USD référencés dans les grilles publiques des vendeurs (Bedrock, OpenAI). Aucun engagement Bedrock (Provisioned Throughput, batch, Savings Plans) n&apos;est déduit ici. Les fourchettes des recommandations sont indicatives — à valider avec vos consommations réelles via
        {" "}
        <Link href="/assistant" className="underline underline-offset-2 hover:text-foreground">
          l&apos;Assistant
        </Link>
        {" "}(les tokens sont journalisés par tour).
      </p>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VolumeInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value)
          onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0)
        }}
        className="h-9 rounded-md border border-border bg-card px-2.5 text-right tabular-nums text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-green)]/40"
      />
    </label>
  )
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const meta = SEVERITY_META[rec.severity]
  const Icon = meta.icon
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
          <Badge variant={meta.badge} className="text-[10px]">
            {meta.label}
          </Badge>
        </div>
        {rec.potentialMonthlyUsd > 0 && (
          <span className="text-[11px] tabular-nums text-[color:var(--accent-green)]">
            ~{fmtUsd(rec.potentialMonthlyUsd)}/mois
          </span>
        )}
      </div>
      <p className="text-sm font-semibold text-foreground leading-tight">
        {rec.title}
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed">{rec.body}</p>
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  CheckCircle2,
  Gauge,
  Info,
  PauseCircle,
  StopCircle,
  Users,
} from "lucide-react"

import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import {
  usePortfolioAggregate,
  PROVIDER_SHORT,
  type Portfolio,
  type Provider,
} from "@/lib/hooks/usePortfolios"
import { cn } from "@/lib/utils"
import {
  classifyProject,
  memberKey,
  type Verdict,
} from "./roiHeuristics"
import { estimateMonthlyCost } from "./monthlyCost"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENCY_SIGN: Record<string, string> = { EUR: "€", USD: "$" }

function fmtMoney(v: number, currency = "EUR"): string {
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} ${
    CURRENCY_SIGN[currency] ?? currency
  }`
}

// localStorage key: usage inputs are per-portfolio so a workshop lead can
// switch context without losing the numbers of another audit.
function storageKeyFor(portfolioId: string): string {
  return `optimiser:roi-usage:${portfolioId}`
}

function loadUsage(portfolioId: string): Record<string, number> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(storageKeyFor(portfolioId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v
      }
      return out
    }
  } catch {
    // Corrupt payload — ignore silently and start fresh.
  }
  return {}
}

function saveUsage(portfolioId: string, usage: Record<string, number>): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(storageKeyFor(portfolioId), JSON.stringify(usage))
  } catch {
    // Quota exceeded / storage disabled — non-fatal, verdicts still render.
  }
}

// ---------------------------------------------------------------------------
// Verdict presentation
// ---------------------------------------------------------------------------

const VERDICT_META: Record<
  Verdict,
  { label: string; badgeVariant: "success" | "warning" | "destructive"; icon: typeof CheckCircle2 }
> = {
  keep: { label: "Continuer", badgeVariant: "success", icon: CheckCircle2 },
  slow: { label: "Ralentir", badgeVariant: "warning", icon: PauseCircle },
  stop: { label: "Stopper", badgeVariant: "destructive", icon: StopCircle },
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ProjectsRoiAuditProps {
  // Portfolio to audit. Owner (the Optimiser page) synthesises a single-member
  // "local" portfolio for the Vue projet source, or passes the real one for
  // Vue portefeuille. Null when the user is on the portefeuille source but
  // hasn't picked or configured one.
  portfolio: Portfolio | null
}

export function ProjectsRoiAudit({ portfolio }: ProjectsRoiAuditProps) {
  const aggregate = usePortfolioAggregate(portfolio)

  // Usage inputs are hydrated from localStorage on portfolio switch using
  // React's "adjusting state during rendering" pattern — see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [hydratedFor, setHydratedFor] = useState<string | null>(null)
  const currentPortfolioId = portfolio?.id ?? null
  if (currentPortfolioId !== hydratedFor) {
    setHydratedFor(currentPortfolioId)
    setUsage(currentPortfolioId ? loadUsage(currentPortfolioId) : {})
  }

  const setMemberUsage = (key: string, users: number | null) => {
    if (!portfolio) return
    setUsage((prev) => {
      const next = { ...prev }
      if (users == null || Number.isNaN(users)) delete next[key]
      else next[key] = users
      saveUsage(portfolio.id, next)
      return next
    })
  }

  const rows = useMemo(() => {
    if (!portfolio) return []
    return aggregate.members.map((m) => {
      const key = memberKey(m.provider, m.id)
      const monthly = estimateMonthlyCost(m.byMonth, m.total)
      const users = usage[key] ?? null
      const result = classifyProject({ monthlyCost: monthly, users })
      return {
        key,
        provider: m.provider as Provider,
        id: m.id,
        label: m.label,
        monthly,
        users,
        result,
      }
    })
  }, [aggregate.members, portfolio, usage])

  const summary = useMemo(() => {
    const buckets = { keep: 0, slow: 0, stop: 0 }
    let potentialSavings = 0
    for (const r of rows) {
      buckets[r.result.verdict] += 1
      potentialSavings += r.result.potentialSavings
    }
    return { ...buckets, potentialSavings }
  }, [rows])

  // ---------------------- Empty / loading branches ------------------------
  if (!portfolio) {
    return (
      <SectionCard
        title="Audit d'usage des projets"
        description="Croise le coût mensuel avec le volume d'utilisateurs de chaque projet pour trancher : continuer, ralentir ou stopper."
        accent="green"
      >
        <EmptyState
          icon={Users}
          title="Aucune source sélectionnée"
          description="Choisissez une source dans l'en-tête (Vue projet ou Vue portefeuille) ou créez un portefeuille pour lancer l'audit."
          action={
            <Link href="/portefeuille">
              <Button variant="outline" className="gap-2">
                Configurer un portefeuille
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          }
        />
      </SectionCard>
    )
  }

  if (aggregate.loading && !aggregate.hasAnyData) {
    return (
      <SectionCard title="Audit d'usage des projets" accent="green">
        <div className="space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </SectionCard>
    )
  }

  const currency = aggregate.currency

  return (
    <SectionCard
      title="Audit d'usage des projets"
      description="Renseignez le nombre d'utilisateurs actifs par mois pour chaque projet : le verdict s'ajuste en fonction du coût réel constaté."
      accent="green"
      action={<Badge variant="muted">{portfolio.name}</Badge>}
      contentClassName="space-y-5"
    >
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="À stopper"
          value={summary.stop}
          sub={`sur ${rows.length} projets`}
          icon={StopCircle}
          tone={summary.stop > 0 ? "destructive" : "default"}
        />
        <KpiCard
          label="À ralentir"
          value={summary.slow}
          sub={`sur ${rows.length} projets`}
          icon={PauseCircle}
          tone={summary.slow > 0 ? "green" : "default"}
        />
        <KpiCard
          label="Économies mensuelles potentielles"
          value={fmtMoney(summary.potentialSavings, currency)}
          sub="cumul stop + rightsizing"
          icon={Gauge}
          tone={summary.potentialSavings > 0 ? "success" : "default"}
        />
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <EmptyState
          icon={Info}
          title="Portefeuille sans membres"
          description="Ajoutez au moins un compte GCP, AWS ou Azure à ce portefeuille pour lancer l'audit."
          action={
            <Link href="/portefeuille">
              <Button variant="outline" className="gap-2">
                Éditer le portefeuille
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Projet</th>
                <th className="px-3 py-2 text-right font-medium">Coût mensuel</th>
                <th className="px-3 py-2 text-right font-medium">Utilisateurs / mois</th>
                <th className="px-3 py-2 text-right font-medium">€ / user</th>
                <th className="px-3 py-2 text-left font-medium">Verdict</th>
                <th className="px-3 py-2 text-left font-medium">Piste</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <ProjectRow
                  key={row.key}
                  label={row.label}
                  provider={row.provider}
                  monthly={row.monthly}
                  currency={currency}
                  users={row.users}
                  result={row.result}
                  onUsersChange={(v) => setMemberUsage(row.key, v)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface ProjectRowProps {
  label: string
  provider: Provider
  monthly: number
  currency: string
  users: number | null
  result: ReturnType<typeof classifyProject>
  onUsersChange: (v: number | null) => void
}

function ProjectRow({
  label,
  provider,
  monthly,
  currency,
  users,
  result,
  onUsersChange,
}: ProjectRowProps) {
  const meta = VERDICT_META[result.verdict]
  const Icon = meta.icon

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{label}</span>
          <Badge variant="muted" className="text-[10px]">
            {PROVIDER_SHORT[provider]}
          </Badge>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {fmtMoney(monthly, currency)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={users ?? ""}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === "") onUsersChange(null)
            else {
              const parsed = Number(raw)
              onUsersChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : null)
            }
          }}
          placeholder="—"
          className="h-8 w-24 rounded-md border border-border bg-card px-2 text-right tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-green)]/40"
          aria-label={`Utilisateurs actifs par mois pour ${label}`}
        />
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
        {result.costPerUser != null ? fmtMoney(result.costPerUser, currency) : "—"}
      </td>
      <td className="px-3 py-2.5">
        <Badge variant={meta.badgeVariant} className="gap-1">
          <Icon className="h-3 w-3" aria-hidden />
          {meta.label}
        </Badge>
      </td>
      <td className="px-3 py-2.5 max-w-md">
        <p className="text-xs text-foreground leading-snug">{result.reason}</p>
        <p
          className={cn(
            "text-[11px] leading-snug mt-0.5",
            result.verdict === "keep"
              ? "text-muted-foreground"
              : "text-[color:var(--accent-green)]",
          )}
        >
          {result.next}
        </p>
      </td>
    </tr>
  )
}

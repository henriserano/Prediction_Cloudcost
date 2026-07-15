"use client"

import { useMemo } from "react"
import Link from "next/link"
import {
  ArrowRight,
  ArrowUpRight,
  Database,
  HardDrive,
  Info,
  Layers,
  Lightbulb,
  Network,
  Server,
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
import {
  matchServices,
  type Category,
  type MatchedArbitrage,
} from "./archArbitrageCatalog"
import { estimateMonthlyCost } from "./monthlyCost"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CURRENCY_SIGN: Record<string, string> = { EUR: "€", USD: "$" }
// The billing endpoints return a 6-month cumulative window. matchServices
// divides per-service line items by this constant to yield a monthly proxy;
// keep it aligned with usePortfolioAggregate.MEMBER_MONTHS.
const BILLING_WINDOW_MONTHS = 6

function fmtMoney(v: number, currency = "EUR"): string {
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} ${
    CURRENCY_SIGN[currency] ?? currency
  }`
}

function fmtRange(min: number, max: number, currency = "EUR"): string {
  const sign = CURRENCY_SIGN[currency] ?? currency
  return `${min.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} – ${max.toLocaleString(
    "fr-FR",
    { maximumFractionDigits: 0 },
  )} ${sign}`
}

// When a rule matches several billing lines (typical on AWS: EC2 splits into
// Compute, Other, Data Transfer…), show the first one plus a "+N lignes" hint
// so the card stays readable. Full list still available on hover via ``title``.
function formatMatchedServices(joined: string, matchCount: number): string {
  if (matchCount <= 1) return `Service détecté : ${joined}.`
  const first = joined.split(", ")[0]
  const extra = matchCount - 1
  return `Services détectés : ${first} (+${extra} ligne${extra > 1 ? "s" : ""}).`
}

const CATEGORY_META: Record<
  Category,
  { label: string; icon: typeof Server }
> = {
  compute: { label: "Compute", icon: Server },
  database: { label: "Base de données", icon: Database },
  storage: { label: "Stockage", icon: HardDrive },
  network: { label: "Réseau", icon: Network },
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface MemberArbitrage {
  provider: Provider
  id: string
  label: string
  monthlyTotal: number
  arbitrages: MatchedArbitrage[]
}

interface ArchitectureArbitrageProps {
  // Portfolio to audit — synthesised by the Optimiser page for the Vue projet
  // source, or a real one for Vue portefeuille. Null when the user is on the
  // portefeuille source but hasn't picked or configured one.
  portfolio: Portfolio | null
}

export function ArchitectureArbitrage({ portfolio }: ArchitectureArbitrageProps) {
  const aggregate = usePortfolioAggregate(portfolio)

  const members = useMemo<MemberArbitrage[]>(() => {
    if (!portfolio) return []
    return aggregate.members.map((m) => {
      const arbitrages = matchServices(m.byService, BILLING_WINDOW_MONTHS)
      return {
        provider: m.provider as Provider,
        id: m.id,
        label: m.label,
        // Member header shows the same monthly proxy as ProjectsRoiAudit
        // (avg of last 3 months) so the two audits agree on "coût mensuel".
        // Per-service arbitrages below still divide by BILLING_WINDOW_MONTHS
        // because we don't have per-service, per-month granularity.
        monthlyTotal: estimateMonthlyCost(m.byMonth, m.total, BILLING_WINDOW_MONTHS),
        arbitrages,
      }
    })
  }, [aggregate.members, portfolio])

  const summary = useMemo(() => {
    let opportunities = 0
    let savingsMin = 0
    let savingsMax = 0
    let touchedCost = 0
    for (const m of members) {
      opportunities += m.arbitrages.length
      for (const a of m.arbitrages) {
        savingsMin += a.potentialSavingsRange[0]
        savingsMax += a.potentialSavingsRange[1]
        touchedCost += a.monthlyCost
      }
    }
    return { opportunities, savingsMin, savingsMax, touchedCost }
  }, [members])

  // ---------------------- Empty / loading branches ------------------------
  if (!portfolio) {
    return (
      <SectionCard
        title="Arbitrages d'architecture"
        description="Détecte les services d'infrastructure de chaque projet et propose des alternatives (EC2 ↔ ECS Fargate ↔ App Runner, RDS ↔ Aurora Serverless…) avec une fourchette d'économies."
        accent="brand"
      >
        <EmptyState
          icon={Layers}
          title="Aucune source sélectionnée"
          description="Choisissez une source dans l'en-tête (Vue projet ou Vue portefeuille) pour lancer l'audit d'architecture."
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

  // Wait for per-member billing before rendering: showing an empty
  // "Aucun service majeur reconnu" while the /billing calls are still in
  // flight would confuse the user into thinking no opportunity exists.
  if (aggregate.loading && !aggregate.hasAnyData) {
    return (
      <SectionCard title="Arbitrages d'architecture" accent="brand">
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
      title="Arbitrages d'architecture"
      description="Pour chaque projet, les services d'infrastructure détectés sont confrontés à un catalogue d'alternatives avec fourchette d'économie et compromis. Les fourchettes sont indicatives — à valider selon le profil d'utilisation."
      accent="brand"
      action={<Badge variant="muted">{portfolio.name}</Badge>}
      contentClassName="space-y-5"
    >
      {/* Summary KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Pistes détectées"
          value={summary.opportunities}
          sub={`sur ${members.length} projets`}
          icon={Lightbulb}
          tone={summary.opportunities > 0 ? "green" : "default"}
        />
        <KpiCard
          label="Dépense concernée"
          value={fmtMoney(summary.touchedCost, currency)}
          sub="coût mensuel des services touchés par une piste"
          icon={Server}
        />
        <KpiCard
          label="Économies mensuelles possibles"
          value={
            summary.opportunities > 0
              ? fmtRange(summary.savingsMin, summary.savingsMax, currency)
              : "—"
          }
          sub="fourchette min – max cumulée"
          icon={ArrowRight}
          tone={summary.opportunities > 0 ? "success" : "default"}
        />
      </div>

      {/* Members */}
      {members.length === 0 ? (
        <EmptyState
          icon={Info}
          title="Portefeuille sans membres"
          description="Ajoutez au moins un compte GCP, AWS ou Azure pour lancer l'audit d'architecture."
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
        <div className="space-y-4">
          {members.map((m) => (
            <MemberBlock key={`${m.provider}-${m.id}`} member={m} currency={currency} />
          ))}
        </div>
      )}

    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Per-member block
// ---------------------------------------------------------------------------

function MemberBlock({
  member,
  currency,
}: {
  member: MemberArbitrage
  currency: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-heading text-sm font-semibold text-foreground truncate">
            {member.label}
          </span>
          <Badge variant="muted" className="text-[10px]">
            {PROVIDER_SHORT[member.provider]}
          </Badge>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Coût mensuel
          </div>
          <div className="text-sm font-semibold tabular-nums text-foreground">
            {fmtMoney(member.monthlyTotal, currency)}
          </div>
        </div>
      </div>

      {member.arbitrages.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          Aucun service majeur reconnu par le catalogue.
          <br />
          Un service émergent ou peu répandu ? Vérifiez son coût dans{" "}
          <Link href="/analyse" className="underline underline-offset-2 hover:text-foreground">
            Analyse
          </Link>
          .
        </div>
      ) : (
        <div className="divide-y divide-border">
          {member.arbitrages.map((a) => (
            <ArbitrageCard key={a.rule.id} match={a} currency={currency} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One arbitrage card = one rule fired
// ---------------------------------------------------------------------------

function ArbitrageCard({
  match,
  currency,
}: {
  match: MatchedArbitrage
  currency: string
}) {
  const { rule } = match
  const catMeta = CATEGORY_META[rule.category]
  const CatIcon = catMeta.icon

  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <CatIcon className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="font-semibold text-sm text-foreground">
              {rule.title}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {catMeta.label}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {rule.currentContext}{" "}
            <span className="text-foreground font-medium" title={match.service}>
              {formatMatchedServices(match.service, match.matchCount)}
            </span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Coût mensuel
          </div>
          <div className="text-sm font-semibold tabular-nums text-foreground">
            {fmtMoney(match.monthlyCost, currency)}
          </div>
          <div className="text-[10px] text-[color:var(--accent-green)] mt-1 tabular-nums">
            Éco. possible : {fmtRange(
              match.potentialSavingsRange[0],
              match.potentialSavingsRange[1],
              currency,
            )}
            /mois
          </div>
        </div>
      </div>

      {/* Alternatives */}
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        {rule.alternatives.map((alt) => {
          const min = match.monthlyCost * (alt.savingsPct[0] / 100)
          const max = match.monthlyCost * (alt.savingsPct[1] / 100)
          return (
            <div
              key={alt.name}
              className="rounded-lg border border-border bg-muted/20 px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  → {alt.name}
                </span>
                <span className="text-[10px] tabular-nums text-[color:var(--accent-green)] shrink-0">
                  −{alt.savingsPct[0]}–{alt.savingsPct[1]}%
                  <span className="text-muted-foreground ml-1">
                    ({fmtRange(min, max, currency)})
                  </span>
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                <span className="text-foreground">Bien adapté :</span> {alt.fitFor}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                <span className="text-foreground">Contrepartie :</span>{" "}
                {alt.tradeOffs}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

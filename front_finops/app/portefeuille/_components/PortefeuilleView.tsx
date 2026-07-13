"use client"

import { useState } from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  Briefcase,
  Cloud as CloudIcon,
  FileSpreadsheet,
  Layers,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react"
import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"

import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { WarnBanner } from "@/components/ui/banners"
import {
  LOCAL_MEMBER_ID,
  LOCAL_MEMBER_LABEL,
  PROVIDER_LABEL,
  PROVIDER_SHORT,
  usePortfolioAggregate,
  usePortfolios,
  useAvailableAccounts,
  type Portfolio,
  type PortfolioMember,
  type Provider,
} from "@/lib/hooks/usePortfolios"
import { cn, truncateLabel } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Chart palette — reused from other collecte visualisations for consistency
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  "oklch(0.14 0 0)",
  "oklch(0.68 0.15 160)",
  "oklch(0.65 0.13 240)",
  "oklch(0.72 0.14 15)",
  "oklch(0.75 0.15 78)",
  "oklch(0.62 0.14 155)",
  "oklch(0.48 0.02 250)",
  "oklch(0.60 0.11 195)",
]
const COLOR_GREEN = "oklch(0.68 0.15 160)"
const COLOR_MUTED = "oklch(0.65 0.02 250)"

const PROVIDER_COLOR: Record<Provider, string> = {
  gcp: "oklch(0.65 0.13 240)",   // sky
  aws: "oklch(0.75 0.15 78)",    // gold
  azure: "oklch(0.62 0.14 155)", // green
  local: "oklch(0.48 0.02 250)", // slate — visually neutral for the file source
}

function currencyFmt(v: number, currency = "EUR"): string {
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} ${currency === "USD" ? "$" : "€"}`
}

// ---------------------------------------------------------------------------
// Left rail — portfolio picker + inline editor
// ---------------------------------------------------------------------------

function PortfolioList({
  portfolios,
  selectedId,
  onSelect,
  onCreate,
}: {
  portfolios: Portfolio[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  return (
    <SectionCard
      title="Portefeuilles"
      description={`${portfolios.length} défini${portfolios.length > 1 ? "s" : ""}`}
      accent="green"
      contentClassName="space-y-1.5"
    >
      {portfolios.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucun portefeuille. Créez-en un pour agréger vos comptes cloud.
        </p>
      ) : (
        <ul className="space-y-1">
          {portfolios.map((p) => {
            const active = p.id === selectedId
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  aria-pressed={active}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                    active
                      ? "bg-[color:var(--accent-green)]/10 text-foreground ring-1 ring-[color:var(--accent-green)]/25"
                      : "hover:bg-muted",
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Briefcase
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "text-[color:var(--accent-green)]" : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <span className="truncate text-sm font-medium">{p.name}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {p.members.length} src
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Button variant="outline" onClick={onCreate} className="w-full gap-2 mt-2">
        <Plus className="h-3.5 w-3.5" />
        Nouveau portefeuille
      </Button>
    </SectionCard>
  )
}

function CreatePortfolioForm({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate(trimmed)
  }
  return (
    <SectionCard title="Nouveau portefeuille" description="Nommez le regroupement">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex. France Prod, R&D, Client X…"
          className="flex-1 min-w-[220px] rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-green)]/40"
        />
        <Button type="submit" disabled={!name.trim()}>
          Créer
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
      </form>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Portfolio editor — add/remove members from an existing portfolio
// ---------------------------------------------------------------------------

function ProviderChip({ provider }: { provider: Provider }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{
        color: PROVIDER_COLOR[provider],
        backgroundColor: `${PROVIDER_COLOR[provider]}15`,
      }}
      title={PROVIDER_LABEL[provider]}
    >
      <CloudIcon className="h-2.5 w-2.5" aria-hidden />
      {PROVIDER_SHORT[provider]}
    </span>
  )
}

function PortfolioEditor({
  portfolio,
  onRename,
  onRemove,
  onAddMember,
  onRemoveMember,
}: {
  portfolio: Portfolio
  onRename: (name: string) => void
  onRemove: () => void
  onAddMember: (m: PortfolioMember) => void
  onRemoveMember: (provider: Provider, id: string) => void
}) {
  // The component is remounted by the parent (key={portfolio.id}) whenever
  // the active portfolio changes, so useState seeds fresh from the new name
  // without needing a re-sync effect.
  const [name, setName] = useState(portfolio.name)
  const { accounts, loading } = useAvailableAccounts()

  // The local events store is its own section (toggle), keep it out of the
  // per-cloud-account listing so the user doesn't see "Fichiers importés"
  // listed alongside real accounts.
  const cloudMembers = portfolio.members.filter((m) => m.provider !== "local")
  const hasLocal = portfolio.members.some(
    (m) => m.provider === "local" && m.id === LOCAL_MEMBER_ID,
  )
  const alreadyIn = new Set(cloudMembers.map((m) => `${m.provider}:${m.id}`))
  const availableAccounts = accounts.filter(
    (a) => !alreadyIn.has(`${a.provider}:${a.id}`),
  )

  function toggleLocal() {
    if (hasLocal) {
      onRemoveMember("local", LOCAL_MEMBER_ID)
    } else {
      onAddMember({
        provider: "local",
        id: LOCAL_MEMBER_ID,
        label: LOCAL_MEMBER_LABEL,
      })
    }
  }

  return (
    <SectionCard
      title="Composition du portefeuille"
      description="Renommez, ajoutez ou retirez des comptes/projets. Aucune donnée n'est déplacée."
      contentClassName="space-y-4"
      action={
        <Button variant="outline" size="sm" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
          Supprimer
        </Button>
      }
    >
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Nom du portefeuille
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== portfolio.name && onRename(name.trim())}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-green)]/40"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Comptes cloud inclus ({cloudMembers.length})
        </p>
        {cloudMembers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Aucun compte cloud. Ajoutez-en depuis la liste ci-dessous.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {cloudMembers.map((m) => (
              <li
                key={`${m.provider}:${m.id}`}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2"
              >
                <ProviderChip provider={m.provider} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{m.label || m.id}</p>
                  <p className="font-mono text-[11px] text-muted-foreground truncate">
                    {m.id}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveMember(m.provider, m.id)}
                  className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label="Retirer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Fichiers importés — le pot local est un singleton, contrôlé par un
          simple toggle. Ajoute {provider:"local", id:LOCAL_MEMBER_ID} au
          portefeuille, ce qui fait apparaître les events de la Fichier tab
          dans l'agrégat consolidé (via /api/events/billing). */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Fichiers importés
        </p>
        <label
          className={cn(
            "flex items-start gap-3 rounded-lg border px-3 py-3 cursor-pointer transition-colors",
            hasLocal
              ? "border-[color:var(--accent-green)]/40 bg-[color:var(--accent-green)]/5"
              : "border-border bg-card hover:border-[color:var(--accent-green)]/30",
          )}
        >
          <input
            type="checkbox"
            checked={hasLocal}
            onChange={toggleLocal}
            className="mt-0.5 h-4 w-4 rounded border-border accent-[color:var(--accent-green)]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
              <p className="text-sm font-medium">Inclure les fichiers importés</p>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Ajoute les events déposés depuis la <Link href="/collecte" className="underline underline-offset-2 text-foreground hover:text-[color:var(--accent-green)]">Fichier tab</Link> à ce portefeuille. Un seul pot local partagé entre tous les portefeuilles qui l&apos;activent.
            </p>
          </div>
        </label>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Ajouter un compte
        </p>
        {loading && <p className="text-xs text-muted-foreground">Chargement…</p>}
        {!loading && availableAccounts.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Tous les comptes connus sont déjà dans ce portefeuille.{" "}
            <Link href="/collecte" className="underline underline-offset-2">
              Connectez un autre compte
            </Link>{" "}
            depuis la page Collecte.
          </p>
        )}
        {!loading && availableAccounts.length > 0 && (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {availableAccounts.map((a) => (
              <li key={`${a.provider}:${a.id}`}>
                <button
                  type="button"
                  onClick={() => onAddMember({ provider: a.provider, id: a.id, label: a.label })}
                  className="w-full flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left hover:border-[color:var(--accent-green)]/40 hover:bg-[color:var(--accent-green)]/5 transition-colors"
                >
                  <ProviderChip provider={a.provider} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{a.label}</p>
                    <p className="font-mono text-[11px] text-muted-foreground truncate">
                      {a.id}
                    </p>
                  </div>
                  <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Right column — consolidated view of the selected portfolio
// ---------------------------------------------------------------------------

function ConsolidatedKPIs({
  totalCost,
  currency,
  memberCount,
  providerCount,
  monthly,
}: {
  totalCost: number
  currency: string
  memberCount: number
  providerCount: number
  monthly: { month: string; cost: number }[]
}) {
  // Month-over-month comparison, taking the last two closed months
  let trendPct: number | null = null
  if (monthly.length >= 2) {
    const [prev, curr] = monthly.slice(-2)
    if (prev.cost > 0) {
      trendPct = ((curr.cost - prev.cost) / prev.cost) * 100
    }
  }

  return (
    <section aria-label="KPI portefeuille" className="grid grid-cols-1 sm:grid-cols-4 gap-3 lg:gap-4">
      <KpiCard
        label="Coût consolidé"
        value={currencyFmt(totalCost, currency)}
        sub={`${monthly.length || 0} mois d'historique`}
        icon={Wallet}
        tone="green"
      />
      <KpiCard
        label="Comptes agrégés"
        value={memberCount}
        sub={`${providerCount} provider${providerCount > 1 ? "s" : ""}`}
        icon={Layers}
        tone="default"
      />
      <KpiCard
        label="Tendance M/M-1"
        value={trendPct == null ? "—" : `${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)} %`}
        sub={trendPct == null ? "Données insuffisantes" : "Dernier mois vs. précédent"}
        icon={Wallet}
        tone={trendPct == null ? "default" : trendPct > 5 ? "destructive" : "success"}
      />
      <KpiCard
        label="Devise"
        value={currency}
        sub="Provider primaire"
        icon={CloudIcon}
        tone="default"
      />
    </section>
  )
}

function SplitByProvider({
  byProvider,
  totalCost,
  currency,
}: {
  byProvider: { provider: Provider; cost: number; pct: number }[]
  totalCost: number
  currency: string
}) {
  return (
    <SectionCard
      title="Répartition par provider"
      description="Part de chaque fournisseur dans la dépense consolidée"
      accent="green"
    >
      {totalCost === 0 ? (
        <EmptyState title="Pas encore de données" />
      ) : (
        <div className="space-y-3">
          <div
            className="h-3 w-full rounded-full overflow-hidden flex bg-muted"
            role="img"
            aria-label="Répartition par provider"
          >
            {byProvider.map((row) => (
              <div
                key={row.provider}
                className="h-full transition-all"
                style={{
                  width: `${row.pct}%`,
                  backgroundColor: PROVIDER_COLOR[row.provider],
                }}
                title={`${PROVIDER_LABEL[row.provider]} · ${row.pct.toFixed(1)}%`}
              />
            ))}
          </div>
          <ul className="grid gap-2 sm:grid-cols-3">
            {byProvider.map((row) => (
              <li key={row.provider} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: PROVIDER_COLOR[row.provider] }}
                  />
                  <p className="text-xs font-semibold">{PROVIDER_LABEL[row.provider]}</p>
                </div>
                <p className="font-heading text-lg font-semibold tabular-nums">
                  {currencyFmt(row.cost, currency)}
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {row.pct.toFixed(1)}% du portefeuille
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}

function SplitByMember({
  byMember,
  currency,
}: {
  byMember: { provider: Provider; id: string; label: string; cost: number; pct: number }[]
  currency: string
}) {
  return (
    <SectionCard
      title="Répartition par compte / projet"
      description={`${byMember.length} source${byMember.length > 1 ? "s" : ""} triées par coût`}
    >
      {byMember.length === 0 ? (
        <EmptyState title="Aucun compte dans ce portefeuille" />
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="pb-2.5 text-left font-medium pl-1">Compte / Projet</th>
                <th className="pb-2.5 text-left font-medium">Provider</th>
                <th className="pb-2.5 text-right font-medium">Coût</th>
                <th className="pb-2.5 text-right font-medium pr-1">Part</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {byMember.map((m) => (
                <tr key={`${m.provider}:${m.id}`} className="hover:bg-muted/40 transition-colors">
                  <td className="py-2.5 pl-1">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.label}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {m.id}
                      </p>
                    </div>
                  </td>
                  <td className="py-2.5">
                    <ProviderChip provider={m.provider} />
                  </td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">
                    {currencyFmt(m.cost, currency)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground pr-1">
                    {m.pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

function TopServicesPareto({
  topServices,
  currency,
}: {
  topServices: { service: string; cost: number; pct: number; cumPct: number }[]
  currency: string
}) {
  const rows = topServices.slice(0, 12)
  return (
    <SectionCard
      title="Top services cross-cloud"
      description="Loi 80/20 · services agrégés tous providers confondus"
    >
      {rows.length === 0 ? (
        <EmptyState title="Aucun service" />
      ) : (
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={rows} margin={{ left: -18, right: 32, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              dataKey="service"
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              angle={-35}
              textAnchor="end"
              height={110}
              interval={0}
              tickMargin={8}
              tickFormatter={(v: string) => truncateLabel(v, 20)}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              unit={currency === "USD" ? " $" : " €"}
              width={64}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              unit="%"
              domain={[0, 100]}
              width={38}
            />
            <Tooltip
              cursor={{ fill: "oklch(0 0 0 / 0.03)" }}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid oklch(0.90 0.010 250)",
                fontSize: 12,
              }}
              formatter={(v: unknown, name: string) => {
                const x = v as number
                return name === "cumPct"
                  ? [`${x.toFixed(1)}%`, "% cumulé"]
                  : [currencyFmt(x, currency), "Coût"]
              }}
            />
            <ReferenceLine
              yAxisId="right"
              y={80}
              stroke={COLOR_GREEN}
              strokeDasharray="4 2"
              label={{ value: "80%", position: "right", fontSize: 10, fill: COLOR_GREEN }}
            />
            <Bar yAxisId="left" dataKey="cost" radius={[6, 6, 0, 0]} name="Coût">
              {rows.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cumPct"
              stroke={COLOR_GREEN}
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: COLOR_GREEN, stroke: "white", strokeWidth: 2 }}
              name="% cumulé"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Public entry — orchestrates the whole portefeuille view
// ---------------------------------------------------------------------------

export function PortefeuilleView() {
  const { portfolios, ops } = usePortfolios()
  const [wantedId, setWantedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Derive the effective selection at render time so a deleted portfolio or a
  // fresh list falls back to the first entry — no useEffect/setState chain
  // that would trigger cascading re-renders when portfolios changes.
  const effectiveId =
    wantedId && portfolios.some((p) => p.id === wantedId)
      ? wantedId
      : portfolios[0]?.id ?? null
  const selectedId = effectiveId
  const selected = portfolios.find((p) => p.id === effectiveId) ?? null
  const aggregate = usePortfolioAggregate(selected)

  const mixedCurrencies =
    aggregate.members.length > 1 &&
    new Set(aggregate.members.filter((m) => m.total > 0).map((m) => m.currency)).size > 1

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,280px)_1fr] gap-4 lg:gap-5">
      {/* Left rail */}
      <aside className="space-y-4">
        <PortfolioList
          portfolios={portfolios}
          selectedId={selectedId}
          onSelect={(id) => {
            setWantedId(id)
            setCreating(false)
          }}
          onCreate={() => setCreating(true)}
        />
      </aside>

      {/* Right column */}
      <div className="space-y-4 lg:space-y-5 min-w-0">
        {creating && (
          <CreatePortfolioForm
            onCreate={async (name) => {
              try {
                const p = await ops.create(name)
                setWantedId(p.id)
                setCreating(false)
              } catch {
                // The API surfaced a validation or auth error; leave the
                // form open so the user can retry. TanStack Query has
                // already logged the failure via retry: false.
              }
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        {!creating && !selected && portfolios.length === 0 && (
          <EmptyState
            icon={Briefcase}
            title="Créez votre premier portefeuille"
            description="Regroupez plusieurs comptes GCP, AWS et Azure pour obtenir une vue consolidée de vos dépenses cloud."
            action={
              <Button onClick={() => setCreating(true)} className="gap-2">
                <Plus className="h-3.5 w-3.5" />
                Nouveau portefeuille
              </Button>
            }
          />
        )}

        {!creating && selected && (
          <>
            <PortfolioEditor
              key={selected.id}
              portfolio={selected}
              onRename={(name) => ops.rename(selected.id, name)}
              onRemove={() => ops.remove(selected.id)}
              onAddMember={(m) => ops.addMember(selected.id, m)}
              onRemoveMember={(provider, id) => ops.removeMember(selected.id, provider, id)}
            />

            {selected.members.length === 0 ? (
              <EmptyState
                icon={CloudIcon}
                title="Portefeuille vide"
                description="Ajoutez au moins un compte pour voir la vue consolidée."
              />
            ) : (
              <>
                {mixedCurrencies && (
                  <WarnBanner message="Devises hétérogènes détectées entre les comptes de ce portefeuille — les totaux affichés sont additionnés sans conversion. Reliez tous vos comptes à la même devise pour un chiffre exact." />
                )}

                {aggregate.loading && (
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-24" />
                    ))}
                  </div>
                )}

                {!aggregate.loading && !aggregate.hasAnyData && !aggregate.hasAnyError && (
                  <EmptyState
                    title="Aucune donnée retournée"
                    description="Les providers connectés n'ont pas encore renvoyé de coûts pour ces comptes."
                  />
                )}

                {aggregate.hasAnyError && !aggregate.loading && (
                  <WarnBanner message="Un ou plusieurs providers ont refusé la requête billing (permission manquante ou session expirée). Les autres comptes restent affichés ci-dessous." />
                )}

                <ConsolidatedKPIs
                  totalCost={aggregate.totalCost}
                  currency={aggregate.currency}
                  memberCount={selected.members.length}
                  providerCount={aggregate.byProvider.length}
                  monthly={aggregate.monthly}
                />

                <SplitByProvider
                  byProvider={aggregate.byProvider}
                  totalCost={aggregate.totalCost}
                  currency={aggregate.currency}
                />

                <SplitByMember byMember={aggregate.byMember} currency={aggregate.currency} />

                <TopServicesPareto
                  topServices={aggregate.topServices}
                  currency={aggregate.currency}
                />

                <SectionCard accent="none" className="bg-muted/20 border-dashed">
                  <div className="flex items-start gap-3 text-sm text-muted-foreground">
                    <Badge variant="muted" size="sm">Info</Badge>
                    <p>
                      La vue portefeuille est <strong>lecture seule</strong> : elle interroge
                      les endpoints billing de chaque provider en temps réel. Pour alimenter
                      les onglets <Link href="/analyse" className="text-foreground underline underline-offset-2 inline-flex items-center gap-1">Analyse<ArrowUpRight className="h-3 w-3" /></Link>
                      {" "}et{" "}
                      <Link href="/projection" className="text-foreground underline underline-offset-2 inline-flex items-center gap-1">Projection<ArrowUpRight className="h-3 w-3" /></Link>,
                      utilisez le bouton &laquo; Utiliser &raquo; sur un compte depuis la vue Projet.
                    </p>
                  </div>
                </SectionCard>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

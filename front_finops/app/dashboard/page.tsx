"use client"

import {
  ComposedChart, Area, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import {
  TrendingUp, AlertTriangle, Wallet, Activity, ShieldCheck,
} from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiCard } from "@/components/ui/kpi-card"
import { SectionCard } from "@/components/ui/section-card"
import { EmptyState } from "@/components/ui/empty-state"
import { QueryError } from "@/components/ui/query-error"
import { useKPI, useDaily, useServices, useAnomalies } from "@/lib/hooks/useApi"
import { formatCurrency } from "@/lib/utils"
import type { DailyPoint } from "@/lib/types"

/**
 * Small colour-chip legend rendered in the SectionCard action slot so users
 * can identify each series without a busy in-chart legend.
 */
function TrendLegend() {
  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-[color:var(--accent-green)]/25 ring-1 ring-[color:var(--accent-green)]/40" />
        IC 95 %
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-[2px] w-4 rounded-full bg-foreground/40" />
        Coût brut
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-[3px] w-4 rounded-full bg-[color:var(--accent-green)]" />
        MA 7 j
      </span>
    </div>
  )
}

// Sia chart palette — black, green, sky-deep, blush-deep, gold
const CHART_COLORS = [
  "oklch(0.14 0 0)",         // Sia black
  "oklch(0.68 0.15 160)",     // Sia green
  "oklch(0.65 0.13 240)",    // sky-deep
  "oklch(0.72 0.14 15)",     // blush-deep
  "oklch(0.75 0.15 78)",     // gold
  "oklch(0.62 0.14 155)",    // green
  "oklch(0.48 0.02 250)",    // slate
  "oklch(0.60 0.11 195)",    // teal
]

const COLOR_GREEN = "oklch(0.68 0.15 160)"
const COLOR_MUTED = "oklch(0.65 0.02 250)"

export default function DashboardPage() {
  const { data: kpi, isLoading: kpiLoading, error: kpiError, refetch: refetchKpi } = useKPI()
  const { data: daily, isLoading: dailyLoading, error: dailyError, refetch: refetchDaily } = useDaily(60)
  const { data: services, isLoading: servicesLoading, error: servicesError, refetch: refetchServices } = useServices()
  const { data: anomalies, isLoading: anomaliesLoading, error: anomaliesError, refetch: refetchAnomalies } = useAnomalies()

  const hasError = !!(kpiError || dailyError || servicesError || anomaliesError)

  const detectedAnomalies = anomalies?.filter((a) => a.isAnomaly) ?? []
  const trendPct = kpi ? ((kpi.trendSlope / Math.max(kpi.dailyAvg, 1)) * 100) : 0

  if (hasError) {
    return (
      <PageShell
        eyebrow="Executive dashboard"
        title="Vue d'ensemble"
        description="Impossible de charger les indicateurs FinOps"
      >
        <QueryError
          onRetry={() => {
            if (kpiError) void refetchKpi()
            if (dailyError) void refetchDaily()
            if (servicesError) void refetchServices()
            if (anomaliesError) void refetchAnomalies()
          }}
        />
      </PageShell>
    )
  }

  return (
    <PageShell
      eyebrow="Executive dashboard"
      title="Vue d'ensemble"
      description={
        kpi
          ? `Consommation cloud du ${kpi.periodStart} au ${kpi.periodEnd} · ${kpi.dataPoints} points de mesure`
          : "Chargement des indicateurs FinOps…"
      }
    >
      {/* KPI grid */}
      <section aria-labelledby="kpi-heading" className="space-y-3">
        <h2 id="kpi-heading" className="sr-only">Indicateurs clés</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {(kpiLoading || !kpi) ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
          ) : (
            <>
              <KpiCard
                label="Dépense totale"
                value={formatCurrency(kpi.totalSpend)}
                sub="Sur la période analysée"
                icon={Wallet}
                tone="default"
              />
              <KpiCard
                label="Moyenne quotidienne"
                value={formatCurrency(kpi.dailyAvg)}
                sub="par jour"
                icon={TrendingUp}
                tone="green"
                delta={{ value: Number(trendPct.toFixed(1)), suffix: "%" }}
              />
              <KpiCard
                label="Prévision 30 j"
                value={formatCurrency(kpi.forecastNext30)}
                sub="Modèle champion · 14 j lissés"
                icon={Activity}
                tone="success"
              />
              <KpiCard
                label="Anomalies détectées"
                value={kpi.anomalyCount}
                sub={kpi.anomalyCount === 0 ? "Aucune alerte" : "Z-score > 2"}
                icon={kpi.anomalyCount === 0 ? ShieldCheck : AlertTriangle}
                tone={kpi.anomalyCount === 0 ? "success" : "destructive"}
              />
            </>
          )}
        </div>
      </section>

      {/* Main chart + service split */}
      <section aria-labelledby="trend-heading" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <h2 id="trend-heading" className="sr-only">Tendance et répartition</h2>

        <SectionCard
          title="Tendance quotidienne"
          description="Coût cloud journalier · 60 jours glissants"
          className="lg:col-span-2"
          action={<TrendLegend />}
        >
          {(dailyLoading || !daily) ? (
            <Skeleton className="h-[260px] lg:h-[320px]" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={daily} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR_GREEN} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={COLOR_GREEN} stopOpacity={0.06} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => v.slice(5)}
                  tick={{ fontSize: 10, fill: COLOR_MUTED }}
                  tickLine={false}
                  axisLine={false}
                  interval={9}
                  minTickGap={16}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: COLOR_MUTED }}
                  tickLine={false}
                  axisLine={false}
                  unit=" €"
                  width={56}
                />
                <Tooltip
                  cursor={{ stroke: COLOR_GREEN, strokeWidth: 1, strokeDasharray: "3 3" }}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid oklch(0.90 0.010 250)",
                    fontSize: 12,
                    boxShadow: "0 4px 12px oklch(0 0 0 / 0.06)",
                    padding: "8px 10px",
                  }}
                  labelStyle={{ fontWeight: 600, marginBottom: 4 }}
                  itemStyle={{ padding: "2px 0" }}
                  formatter={(v: unknown, n: string) => {
                    if (n === "IC 95 %") return [null, null] as unknown as [string, string]
                    const x = v as number
                    return [`${x.toFixed(2)} €`, n]
                  }}
                  labelFormatter={(l) => `Date · ${l}`}
                />
                {/* Confidence interval band — proper range using tuple dataKey.
                    Rendered first so lines paint on top. */}
                <Area
                  type="monotone"
                  dataKey={(d: DailyPoint) => [d.ciLow, d.ciHigh]}
                  fill="url(#ciGrad)"
                  stroke="none"
                  name="IC 95 %"
                  activeDot={false}
                  isAnimationActive={false}
                />
                {/* Raw daily cost — thin, muted, low visual weight */}
                <Line
                  type="monotone"
                  dataKey="cost"
                  stroke="oklch(0.30 0.02 250)"
                  strokeWidth={1}
                  strokeOpacity={0.55}
                  dot={false}
                  name="Coût brut"
                  isAnimationActive={false}
                />
                {/* MA 7 j — Sia green highlight, the star of the chart */}
                <Line
                  type="monotone"
                  dataKey="ma7"
                  stroke={COLOR_GREEN}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: COLOR_GREEN, stroke: "white", strokeWidth: 2 }}
                  name="MA 7 j"
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Répartition services"
          description="Part de la dépense totale"
          accent="green"
        >
          {(servicesLoading || !services) ? (
            <Skeleton className="h-[220px]" />
          ) : (
            <ul className="space-y-3 mt-1">
              {services.slice(0, 6).map((s, i) => (
                <li key={s.service} className="space-y-1.5">
                  <div className="flex justify-between items-baseline text-xs">
                    <span className="truncate max-w-[150px] text-foreground/80 font-medium">{s.service}</span>
                    <span className="tabular-nums font-semibold text-foreground">
                      {s.pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${s.pct}%`, backgroundColor: CHART_COLORS[i] }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </section>

      {/* Anomalies + volatility */}
      <section aria-labelledby="risk-heading" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <h2 id="risk-heading" className="sr-only">Risque et volatilité</h2>

        <Card className="relative overflow-hidden">
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-destructive/60 to-transparent"
          />
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">Anomalies détectées</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Jours avec écart {">"} 2σ par rapport à la moyenne
                </CardDescription>
              </div>
              {!anomaliesLoading && (
                <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive tabular-nums">
                  {detectedAnomalies.length}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {(anomaliesLoading || !anomalies) ? (
              <Skeleton className="h-[140px]" />
            ) : detectedAnomalies.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="Aucune anomalie détectée"
                description="Les coûts restent dans la bande de confiance ±2σ."
              />
            ) : (
              <ul className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                {detectedAnomalies.map((a) => (
                  <li
                    key={a.date}
                    className="flex items-center justify-between rounded-lg border border-destructive/15 bg-destructive/6 px-3 py-2 text-sm transition-colors hover:bg-destructive/10"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        aria-hidden
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-destructive/12"
                      >
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                      </span>
                      <span className="font-medium text-xs tabular-nums">{a.date}</span>
                    </div>
                    <div className="flex items-baseline gap-2.5 tabular-nums text-xs shrink-0">
                      <span className="font-bold text-foreground">
                        {a.cost.toFixed(0)} €
                      </span>
                      <span className="text-destructive/80 text-[11px]">
                        Z = {a.zscore.toFixed(1)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <SectionCard
          title="Volatilité par service"
          description="Coefficient de variation (%) — plus élevé = plus imprévisible"
          accent="green"
        >
          {(servicesLoading || !services) ? (
            <Skeleton className="h-[200px]" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={services.slice(0, 6)} layout="vertical" margin={{ left: 4, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="oklch(0 0 0 / 0.06)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit="%" />
                <YAxis type="category" dataKey="service" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} width={90} />
                <Tooltip
                  cursor={{ fill: "oklch(0 0 0 / 0.03)" }}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid oklch(0.90 0.010 250)",
                    fontSize: 12,
                  }}
                  formatter={(v: unknown) => {
                    const x = v as number
                    return [`${x.toFixed(1)}%`, "Coef. variation"]
                  }}
                />
                <Bar dataKey="cv" radius={[0, 5, 5, 0]}>
                  {services.slice(0, 6).map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </section>
    </PageShell>
  )
}

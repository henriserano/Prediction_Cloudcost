"use client"

import {
  AreaChart, Area, Line, BarChart, Bar, Cell,
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
import { useKPI, useDaily, useServices, useAnomalies } from "@/lib/hooks/useApi"

// Sia chart palette — navy, coral, teal, violet, gold, secondary tones
const CHART_COLORS = [
  "oklch(0.22 0.055 258)",   // navy
  "oklch(0.66 0.185 28)",    // coral
  "oklch(0.60 0.11 195)",    // teal
  "oklch(0.52 0.19 295)",    // violet
  "oklch(0.75 0.15 78)",     // gold
  "oklch(0.62 0.14 155)",    // success green
  "oklch(0.48 0.02 250)",    // slate
  "oklch(0.42 0.15 320)",    // magenta
]

const COLOR_CORAL = "oklch(0.66 0.185 28)"
const COLOR_MUTED = "oklch(0.65 0.02 250)"

export default function DashboardPage() {
  const { data: kpi, isLoading: kpiLoading } = useKPI()
  const { data: daily, isLoading: dailyLoading } = useDaily(60)
  const { data: services, isLoading: servicesLoading } = useServices()
  const { data: anomalies, isLoading: anomaliesLoading } = useAnomalies()

  const detectedAnomalies = anomalies?.filter((a) => a.isAnomaly) ?? []
  const trendPct = kpi ? ((kpi.trendSlope / Math.max(kpi.dailyAvg, 1)) * 100) : 0

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
                value={`${kpi.totalSpend.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`}
                sub="Sur la période analysée"
                icon={Wallet}
                tone="default"
              />
              <KpiCard
                label="Moyenne quotidienne"
                value={`${kpi.dailyAvg.toFixed(0)} €`}
                sub="par jour"
                icon={TrendingUp}
                tone="coral"
                delta={{ value: Number(trendPct.toFixed(1)), suffix: "%" }}
              />
              <KpiCard
                label="Prévision 30 j"
                value={`${(kpi.forecastNext30 / 1000).toFixed(1)}k €`}
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
          description="Coût brut, MA 7 jours, intervalle de confiance 95%"
          className="lg:col-span-2"
        >
          {(dailyLoading || !daily) ? (
            <Skeleton className="h-[260px] lg:h-[300px]" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={daily} margin={{ left: -18, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLOR_CORAL} stopOpacity={0.20} />
                    <stop offset="95%" stopColor={COLOR_CORAL} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
                <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} interval={9} />
                <YAxis tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit=" €" width={56} />
                <Tooltip
                  cursor={{ stroke: COLOR_CORAL, strokeWidth: 1, strokeDasharray: "3 3" }}
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid oklch(0.90 0.010 250)",
                    fontSize: 12,
                    boxShadow: "0 4px 12px oklch(0 0 0 / 0.06)",
                  }}
                  formatter={(v: unknown, n: string) => {
                    const x = v as number
                    return [`${x.toFixed(2)} €`, n]
                  }}
                  labelFormatter={(l) => `Date · ${l}`}
                />
                <Area type="monotone" dataKey="ciHigh" stroke="none" fill="url(#ciGrad)" isAnimationActive={false} />
                <Area type="monotone" dataKey="ciLow" stroke="none" fill="white" isAnimationActive={false} />
                <Line type="monotone" dataKey="cost" stroke={COLOR_MUTED} strokeWidth={1.5} dot={false} name="Coût" />
                <Line type="monotone" dataKey="ma7" stroke={COLOR_CORAL} strokeWidth={2.5} dot={false} name="MA 7 j" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Répartition services"
          description="Part de la dépense totale"
          accent="coral"
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
          accent="coral"
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

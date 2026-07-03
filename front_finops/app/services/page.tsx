"use client"

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts"
import { Layers, Crown, PieChart } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useServices, useKPI } from "@/lib/hooks/useApi"

const CHART_COLORS = [
  "oklch(0.22 0.055 258)",
  "oklch(0.66 0.185 28)",
  "oklch(0.60 0.11 195)",
  "oklch(0.52 0.19 295)",
  "oklch(0.75 0.15 78)",
  "oklch(0.62 0.14 155)",
  "oklch(0.48 0.02 250)",
  "oklch(0.42 0.15 320)",
]

const COLOR_CORAL = "oklch(0.66 0.185 28)"
const COLOR_MUTED = "oklch(0.65 0.02 250)"

function CVBadge({ cv }: { cv: number }) {
  if (cv < 20) return <Badge variant="success">Stable</Badge>
  if (cv < 60) return <Badge variant="warning">Modéré</Badge>
  return <Badge variant="destructive">Volatile</Badge>
}

export default function ServicesPage() {
  const { data: services, isLoading: servicesLoading } = useServices()
  const { data: kpi, isLoading: kpiLoading } = useKPI()

  const top5Pct = services
    ? services.slice(0, 5).reduce((s, svc) => s + svc.pct, 0)
    : 0

  return (
    <PageShell
      eyebrow="Cost breakdown"
      title="Services"
      description="Analyse Pareto 80/20 · répartition et volatilité par service cloud"
    >
      {/* KPI overview */}
      <section aria-label="Indicateurs services" className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
        {(servicesLoading || kpiLoading || !services || !kpi) ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <KpiCard
              label="Services analysés"
              value={services.length}
              sub="Sur la période complète"
              icon={Layers}
              tone="default"
            />
            <KpiCard
              label="Service dominant"
              value={<span className="text-base">{kpi.topService}</span>}
              sub={`${kpi.topServicePct.toFixed(1)}% du coût total`}
              icon={Crown}
              tone="coral"
            />
            <KpiCard
              label="Loi de Pareto"
              value={`${top5Pct.toFixed(0)}%`}
              sub="Concentrés sur les 5 premiers services"
              icon={PieChart}
              tone="success"
            />
          </>
        )}
      </section>

      {/* Pareto chart */}
      <SectionCard
        title="Analyse Pareto 80/20"
        description="Coût par service (barres) · pourcentage cumulé (ligne) · seuil 80% (référence)"
      >
        {(servicesLoading || !services) ? (
          <Skeleton className="h-[300px]" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={services} margin={{ left: -18, right: 32, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
              <XAxis
                dataKey="service"
                tick={{ fontSize: 9, fill: COLOR_MUTED }}
                tickLine={false}
                axisLine={false}
                angle={-20}
                textAnchor="end"
                height={60}
              />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit=" €" width={56} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} width={38} />
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
                    : [`${x.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`, "Coût"]
                }}
              />
              <ReferenceLine
                yAxisId="right"
                y={80}
                stroke={COLOR_CORAL}
                strokeDasharray="4 2"
                label={{ value: "80%", position: "right", fontSize: 10, fill: COLOR_CORAL }}
              />
              <Bar yAxisId="left" dataKey="cost" radius={[6, 6, 0, 0]} name="Coût">
                {services.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumPct"
                stroke={COLOR_CORAL}
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: COLOR_CORAL, stroke: "white", strokeWidth: 2 }}
                name="% cumulé"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </SectionCard>

      {/* Desktop table */}
      <SectionCard
        title="Détail par service"
        description="Coût, part, part cumulée, volatilité et profil de risque"
        className="hidden sm:block"
      >
        {(servicesLoading || !services) ? (
          <Skeleton className="h-[200px]" />
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs">
                  <th className="pb-2.5 text-left font-medium pl-1">Service</th>
                  <th className="pb-2.5 text-right font-medium">Coût total</th>
                  <th className="pb-2.5 text-right font-medium">Part</th>
                  <th className="pb-2.5 text-right font-medium">Cumul</th>
                  <th className="pb-2.5 text-right font-medium">CV</th>
                  <th className="pb-2.5 text-center font-medium pr-1">Profil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {services.map((s, i) => (
                  <tr key={s.service} className="hover:bg-muted/40 transition-colors">
                    <td className="py-2.5 pr-3 pl-1">
                      <div className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                        <span className="text-sm">{s.service}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-semibold">
                      {s.cost.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{s.pct.toFixed(1)}%</td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">{s.cumPct.toFixed(1)}%</td>
                    <td className="py-2.5 text-right tabular-nums">{s.cv.toFixed(1)}%</td>
                    <td className="py-2.5 text-center pr-1"><CVBadge cv={s.cv} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-3">
        {(servicesLoading || !services) ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          services.map((s, i) => (
            <SectionCard key={s.service} accent="none">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0 mt-1"
                    style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span className="text-sm font-medium truncate">{s.service}</span>
                </div>
                <CVBadge cv={s.cv} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Coût</p>
                  <p className="font-bold tabular-nums">
                    {s.cost.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Part</p>
                  <p className="font-semibold tabular-nums">{s.pct.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">CV</p>
                  <p className="font-semibold tabular-nums">{s.cv.toFixed(1)}%</p>
                </div>
              </div>
            </SectionCard>
          ))
        )}
      </div>
    </PageShell>
  )
}

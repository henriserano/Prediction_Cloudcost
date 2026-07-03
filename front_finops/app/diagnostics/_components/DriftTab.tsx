"use client"

import { useMemo } from "react"
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, ReferenceLine,
} from "recharts"
import { Activity, GitCompareArrows, Waves } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useDrift } from "@/lib/hooks/useApi"
import {
  COLOR_BRAND, COLOR_CORAL, COLOR_MUTED, COLOR_DEST,
  chartTooltipStyle, num, fmtP,
} from "./shared"

const PSI_VARIANT: Record<string, "success" | "warning" | "destructive"> = {
  stable: "success",
  moderate: "warning",
  significant: "destructive",
}
const PSI_LABEL: Record<string, string> = {
  stable: "Stable",
  moderate: "Modéré",
  significant: "Significatif",
}

export default function DriftTab() {
  const { data, isLoading, error } = useDrift()

  const changepoints = useMemo(
    () => data?.pageHinkley.filter((p) => p.changeDetected).map((p) => p.date) ?? [],
    [data]
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        <Skeleton className="h-[280px]" />
        <Skeleton className="h-[240px]" />
      </div>
    )
  }
  if (error || !data) {
    return <EmptyState title="Impossible de charger les analyses de drift" />
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* KPIs */}
      <section aria-label="Vue synthétique" className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
        <KpiCard
          label="Kolmogorov-Smirnov"
          value={data.ks.driftDetected ? "Drift" : "Stable"}
          sub={`p = ${fmtP(data.ks.pValue)} · D = ${num(data.ks.statistic, 3)}`}
          icon={GitCompareArrows}
          tone={data.ks.driftDetected ? "destructive" : "success"}
        />
        <KpiCard
          label="PSI"
          value={num(data.psi.psi, 3)}
          sub={PSI_LABEL[data.psi.verdict] ?? data.psi.verdict}
          icon={Activity}
          tone={
            data.psi.verdict === "stable" ? "success"
              : data.psi.verdict === "moderate" ? "coral"
              : "destructive"
          }
        />
        <KpiCard
          label="Page-Hinkley"
          value={data.nChangepointsDetected}
          sub={`${data.nChangepointsDetected === 0 ? "aucun" : "changepoint" + (data.nChangepointsDetected > 1 ? "s" : "")} détecté${data.nChangepointsDetected > 1 ? "s" : ""}`}
          icon={Waves}
          tone={data.nChangepointsDetected === 0 ? "success" : "coral"}
        />
      </section>

      {/* KS periods */}
      <SectionCard
        title="Test de Kolmogorov-Smirnov (2 échantillons)"
        description="Comparaison de distribution entre période de référence et période courante"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div className="rounded-lg border border-border bg-muted/20 p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Référence</p>
            <p className="mt-1 font-heading text-sm font-semibold text-foreground">{data.ks.referencePeriod}</p>
            <p className="text-xs text-muted-foreground tabular-nums mt-0.5">{data.ks.nRef} jours</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Courant</p>
            <p className="mt-1 font-heading text-sm font-semibold text-foreground">{data.ks.currentPeriod}</p>
            <p className="text-xs text-muted-foreground tabular-nums mt-0.5">{data.ks.nCur} jours</p>
          </div>
        </div>
        <div
          className={`rounded-lg border p-3.5 text-xs ${
            data.ks.driftDetected
              ? "border-destructive/25 bg-destructive/6 text-destructive"
              : "border-[color:var(--success)]/20 bg-[color:var(--success)]/10 text-[color:var(--success)]"
          }`}
        >
          <strong>Verdict : </strong>
          {data.ks.driftDetected
            ? "Les deux distributions diffèrent significativement (p < 0.05). Un drift de distribution est probable."
            : "Aucune différence significative entre les distributions (p ≥ 0.05)."}
        </div>
      </SectionCard>

      {/* PSI bins */}
      <SectionCard
        title="Population Stability Index"
        description="Distribution binnée : référence vs courant · contribution PSI par bin"
        action={<Badge variant={PSI_VARIANT[data.psi.verdict] ?? "muted"}>{PSI_LABEL[data.psi.verdict] ?? data.psi.verdict}</Badge>}
      >
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={data.psi.bins.map((b) => ({
              label: `${b.lower.toFixed(1)}–${b.upper.toFixed(1)}`,
              reference: b.refPct,
              current: b.curPct,
              contribution: b.contribution,
            }))}
            margin={{ left: -18, right: 32, top: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              angle={-25}
              textAnchor="end"
              height={50}
            />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} unit="%" width={36} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: unknown, name: string) => {
                const n = v as number
                if (name === "contribution") return [n.toFixed(3), "Contribution PSI"]
                return [`${n.toFixed(1)}%`, name === "reference" ? "Référence" : "Courant"]
              }}
            />
            <Bar yAxisId="left" dataKey="reference" name="reference" fill={COLOR_BRAND} radius={[4, 4, 0, 0]} />
            <Bar yAxisId="left" dataKey="current" name="current" fill={COLOR_CORAL} radius={[4, 4, 0, 0]} />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="contribution"
              stroke={COLOR_DEST}
              strokeWidth={2}
              dot={{ r: 3, fill: COLOR_DEST, stroke: "white", strokeWidth: 1.5 }}
              name="contribution"
            />
          </BarChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-2 text-[11px]">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: COLOR_BRAND }} />
            Référence
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: COLOR_CORAL }} />
            Courant
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-1 rounded" style={{ backgroundColor: COLOR_DEST }} />
            Contribution PSI (droite)
          </span>
        </div>
      </SectionCard>

      {/* Page-Hinkley */}
      <SectionCard
        title="Détection Page-Hinkley (online)"
        description="Statistique PH cumulative · changepoints marqués en corail"
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data.pageHinkley} margin={{ left: -18, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(1, Math.floor(data.pageHinkley.length / 12))}
            />
            <YAxis tick={{ fontSize: 10, fill: COLOR_MUTED }} tickLine={false} axisLine={false} width={50} />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: unknown) => [(v as number).toFixed(3), "PH"]}
              labelFormatter={(l) => `Date · ${l}`}
            />
            {changepoints.map((d) => (
              <ReferenceLine key={d} x={d} stroke={COLOR_CORAL} strokeDasharray="4 2" />
            ))}
            <Line type="monotone" dataKey="phStat" stroke={COLOR_BRAND} strokeWidth={1.5} dot={false} name="phStat" />
          </ComposedChart>
        </ResponsiveContainer>
        {changepoints.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="text-[11px] text-muted-foreground mr-1">Changepoints :</span>
            {changepoints.map((d) => (
              <Badge key={d} variant="coral" size="sm">{d}</Badge>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

"use client"

import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts"
import { Gauge, Wand2, ArrowLeftRight } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useDistribution } from "@/lib/hooks/useApi"
import { COLOR_CORAL, COLOR_MUTED, chartTooltipStyle, num, fmtP } from "./shared"

const TEST_LABEL: Record<string, string> = {
  jarque_bera: "Jarque-Bera",
  shapiro_wilk: "Shapiro-Wilk",
  dagostino_k2: "D'Agostino K²",
}

export default function DistributionTab() {
  const { data, isLoading, error } = useDistribution()

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        <Skeleton className="h-[220px]" />
        <Skeleton className="h-[320px]" />
      </div>
    )
  }
  if (error || !data) {
    return <EmptyState title="Impossible de charger l'analyse de distribution" />
  }

  const anyRejects = data.normalityTests.some((t) => !t.isNormal)

  // Build QQ chart data (each point + a diagonal reference)
  const qqData = data.qqPoints.map(([theoretical, sample]) => ({
    theoretical, sample,
  }))
  const xMin = Math.min(...qqData.map((p) => p.theoretical))
  const xMax = Math.max(...qqData.map((p) => p.theoretical))
  const yMin = Math.min(...qqData.map((p) => p.sample))
  const yMax = Math.max(...qqData.map((p) => p.sample))
  // Fit a line: sample ≈ mean + std * theoretical (using observed min/max)
  const linePoints = [
    { theoretical: xMin, ref: yMin + ((yMax - yMin) * (xMin - xMin)) / Math.max(1e-9, xMax - xMin) },
    { theoretical: xMax, ref: yMax },
  ]

  return (
    <div className="space-y-4 lg:space-y-5">
      <section aria-label="Moments" className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
        <KpiCard
          label="Skewness"
          value={num(data.skewness, 3)}
          sub={Math.abs(data.skewness) < 0.5 ? "Distribution ~symétrique" : data.skewness > 0 ? "Queue à droite" : "Queue à gauche"}
          icon={ArrowLeftRight}
          tone={Math.abs(data.skewness) < 0.5 ? "success" : "coral"}
        />
        <KpiCard
          label="Excess kurtosis"
          value={num(data.kurtosis, 3)}
          sub={Math.abs(data.kurtosis) < 1 ? "≈ normale" : data.kurtosis > 0 ? "Leptokurtique (queues épaisses)" : "Platykurtique (queues fines)"}
          icon={Gauge}
          tone={Math.abs(data.kurtosis) < 1 ? "success" : "coral"}
        />
        <KpiCard
          label="Box-Cox λ"
          value={data.boxcoxLambda != null ? num(data.boxcoxLambda, 3) : "N/A"}
          sub={
            data.boxcoxLambda == null
              ? "Transformation indisponible (données ≤ 0 ?)"
              : Math.abs(data.boxcoxLambda) < 0.1
                ? "λ ≈ 0 → log recommandé"
                : Math.abs(data.boxcoxLambda - 1) < 0.1
                  ? "λ ≈ 1 → identité (pas besoin)"
                  : "Transformation puissance recommandée"
          }
          icon={Wand2}
          tone="default"
        />
      </section>

      {/* Normality tests */}
      <SectionCard
        title="Tests de normalité"
        description="Trois tests indépendants · verdict combiné en pied de tableau"
      >
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="pb-2.5 text-left font-medium pl-1">Test</th>
                <th className="pb-2.5 text-right font-medium">Statistique</th>
                <th className="pb-2.5 text-right font-medium">p-value</th>
                <th className="pb-2.5 text-center font-medium pr-1">Résultat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.normalityTests.map((t) => (
                <tr key={t.name} className="hover:bg-muted/40">
                  <td className="py-2.5 pl-1 font-medium">{TEST_LABEL[t.name] ?? t.name}</td>
                  <td className="py-2.5 text-right tabular-nums">{num(t.statistic, 3)}</td>
                  <td className="py-2.5 text-right tabular-nums">{fmtP(t.pValue)}</td>
                  <td className="py-2.5 text-center pr-1">
                    {t.isNormal
                      ? <Badge variant="success">Normal ✓</Badge>
                      : <Badge variant="destructive">Rejet H₀</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className={`mt-3 rounded-lg border p-3.5 text-xs ${
            anyRejects
              ? "border-destructive/25 bg-destructive/6 text-destructive"
              : "border-[color:var(--success)]/20 bg-[color:var(--success)]/10 text-[color:var(--success)]"
          }`}
        >
          <strong>Verdict combiné : </strong>
          {anyRejects
            ? "Au moins un test rejette la normalité — les modèles reposant sur une hypothèse gaussienne peuvent être biaisés. Envisager une transformation (Box-Cox, log) ou des méthodes non paramétriques."
            : "Les trois tests concluent à la normalité — l'hypothèse gaussienne est raisonnable."}
        </div>
      </SectionCard>

      {/* QQ plot */}
      <SectionCard
        title="QQ-plot (quantiles théoriques vs empiriques)"
        description="Une ligne parfaitement droite indique une distribution normale · déviations = queues"
      >
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ left: -18, right: 8, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0 0 0 / 0.06)" />
            <XAxis
              type="number"
              dataKey="theoretical"
              name="Quantile théorique"
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              label={{ value: "Quantile théorique (N(0,1))", fontSize: 10, fill: COLOR_MUTED, position: "insideBottom", offset: -2 }}
            />
            <YAxis
              type="number"
              dataKey="sample"
              name="Quantile empirique"
              tick={{ fontSize: 10, fill: COLOR_MUTED }}
              tickLine={false}
              axisLine={false}
              width={56}
              label={{ value: "Quantile empirique (€)", fontSize: 10, fill: COLOR_MUTED, angle: -90, position: "insideLeft" }}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v: unknown) => (v as number).toFixed(3)}
            />
            <ReferenceLine
              segment={[
                { x: linePoints[0].theoretical, y: linePoints[0].ref },
                { x: linePoints[1].theoretical, y: linePoints[1].ref },
              ]}
              stroke={COLOR_MUTED}
              strokeDasharray="4 2"
            />
            <Scatter data={qqData} fill={COLOR_CORAL} />
          </ScatterChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  )
}

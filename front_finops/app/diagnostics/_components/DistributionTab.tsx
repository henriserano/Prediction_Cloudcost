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
import { COLOR_GREEN, COLOR_MUTED, chartTooltipStyle, num, fmtP } from "./shared"
import { Explain, Verdict } from "@/components/ui/explain"

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
          tone={Math.abs(data.skewness) < 0.5 ? "success" : "green"}
          info={
            <Explain
              title="Skewness (asymétrie)"
              tone={Math.abs(data.skewness) < 0.5 ? "success" : "warning"}
            >
              <p>
                Mesure l&apos;asymétrie d&apos;une distribution. <strong>= 0</strong> parfaitement symétrique · <strong>&gt; 0</strong> queue à droite (rares grosses valeurs) · <strong>&lt; 0</strong> queue à gauche.
              </p>
              <p className="text-muted-foreground">
                Repères : |skew| &lt; 0.5 = symétrie acceptable · 0.5–1 = modérée · &gt; 1 = très asymétrique.
              </p>
              <Verdict tone={Math.abs(data.skewness) < 0.5 ? "success" : "warning"}>
                {Math.abs(data.skewness) < 0.5
                  ? "Distribution quasi-symétrique — les modèles gaussiens sont adaptés."
                  : data.skewness > 0
                    ? "Queue à droite : quelques journées de très gros coûts tirent la distribution. Une transformation log peut aider."
                    : "Queue à gauche : rare en facturation, vérifiez si vous ne cappez pas les valeurs par le haut."}
              </Verdict>
            </Explain>
          }
        />
        <KpiCard
          label="Excess kurtosis"
          value={num(data.kurtosis, 3)}
          sub={Math.abs(data.kurtosis) < 1 ? "≈ normale" : data.kurtosis > 0 ? "Leptokurtique (queues épaisses)" : "Platykurtique (queues fines)"}
          icon={Gauge}
          tone={Math.abs(data.kurtosis) < 1 ? "success" : "green"}
          info={
            <Explain
              title="Excess kurtosis"
              tone={Math.abs(data.kurtosis) < 1 ? "success" : "warning"}
            >
              <p>
                Mesure la <strong>lourdeur des queues</strong> d&apos;une distribution. Version &laquo; excess &raquo; = kurtosis − 3, donc <strong>0 = normale</strong>.
              </p>
              <p className="text-muted-foreground">
                <strong>&gt; 0</strong> leptokurtique (queues épaisses, valeurs extrêmes plus fréquentes) · <strong>&lt; 0</strong> platykurtique (queues fines, distribution &laquo; aplatie &raquo;).
              </p>
              <Verdict tone={Math.abs(data.kurtosis) < 1 ? "success" : "warning"}>
                {Math.abs(data.kurtosis) < 1
                  ? "Queues proches d'une loi normale — les intervalles de confiance gaussiens sont fiables."
                  : data.kurtosis > 0
                    ? "Queues épaisses : les événements extrêmes sont plus fréquents qu'une gaussienne ne le prédit. Prenez des IC plus larges."
                    : "Queues fines : les extrêmes sont rares, distribution très concentrée autour de la moyenne."}
              </Verdict>
            </Explain>
          }
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
          info={
            <Explain title="Box-Cox lambda" tone="info">
              <p>
                Box-Cox trouve la meilleure transformation puissance de la forme <code className="rounded bg-muted px-1">(xᵏ − 1) / λ</code> pour rendre les données les plus gaussiennes possibles.
              </p>
              <p className="text-muted-foreground">
                Valeurs classiques : <strong>λ = 1</strong> pas de transformation · <strong>λ = 0.5</strong> racine carrée · <strong>λ = 0</strong> log · <strong>λ = -1</strong> inverse.
              </p>
              <Verdict tone="info">
                {data.boxcoxLambda == null
                  ? "Non calculable : Box-Cox exige des valeurs strictement positives."
                  : Math.abs(data.boxcoxLambda) < 0.1
                    ? `λ ≈ 0 : une transformation log rendrait votre série quasi-normale.`
                    : Math.abs(data.boxcoxLambda - 1) < 0.1
                      ? `λ ≈ 1 : votre série est déjà proche d'une normale, aucune transformation nécessaire.`
                      : `λ = ${num(data.boxcoxLambda, 2)} : une transformation puissance ${data.boxcoxLambda < 1 ? "compresserait" : "étendrait"} l'échelle pour la normaliser.`}
              </Verdict>
            </Explain>
          }
        />
      </section>

      {/* Normality tests */}
      <SectionCard
        title="Tests de normalité"
        description="Trois tests indépendants · verdict combiné en pied de tableau"
        info={
          <Explain title="Tests de normalité" tone="info">
            <p>
              Trois tests statistiques évaluent si votre série suit une loi normale N(μ, σ²). H₀ = &laquo; la série est normale &raquo;.
            </p>
            <p>
              <strong>Jarque-Bera</strong> : rapide, basé sur skewness + kurtosis. <strong>Shapiro-Wilk</strong> : puissant pour petits échantillons (n &lt; 5000). <strong>D&apos;Agostino K²</strong> : combine skewness et kurtosis avec correction.
            </p>
            <p className="text-muted-foreground">
              Règle : <strong>p &lt; 0.05</strong> → on rejette H₀ → série non-normale.
            </p>
          </Explain>
        }
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
        info={
          <Explain title="Comment lire un QQ-plot" tone="info">
            <p>
              Chaque point compare un quantile théorique d&apos;une N(0,1) au quantile observé dans vos données. Sur une distribution parfaitement normale, tous les points seraient <strong>alignés sur la droite pointillée</strong>.
            </p>
            <p className="text-muted-foreground">
              <strong>Courbe qui remonte à droite</strong> → queue droite épaisse. <strong>Qui descend à gauche</strong> → queue gauche épaisse. <strong>Forme en S</strong> → excès de kurtosis. <strong>Points dispersés autour</strong> → normalité correcte.
            </p>
          </Explain>
        }
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
            <Scatter data={qqData} fill={COLOR_GREEN} />
          </ScatterChart>
        </ResponsiveContainer>
      </SectionCard>
    </div>
  )
}

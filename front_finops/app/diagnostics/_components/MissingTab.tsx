"use client"

import { useMemo } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts"
import { CalendarClock, Puzzle, HelpCircle } from "lucide-react"
import { SectionCard } from "@/components/ui/section-card"
import { KpiCard } from "@/components/ui/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { useMissing } from "@/lib/hooks/useApi"
import { COLOR_CORAL, COLOR_MUTED, COLOR_SUCCESS, chartTooltipStyle } from "./shared"

const MECHANISM_INFO: Record<string, { badge: "success" | "warning" | "destructive"; explanation: string }> = {
  "MCAR-like": {
    badge: "success",
    explanation:
      "Missing Completely At Random — les valeurs manquantes ne dépendent ni de la valeur observée ni de la valeur manquante. Retrait simple ou imputation naïve acceptables.",
  },
  "MAR-like": {
    badge: "warning",
    explanation:
      "Missing At Random — les valeurs manquantes dépendent d'autres variables observées. Imputation conditionnelle recommandée (KNN, MICE).",
  },
  "MNAR-like": {
    badge: "destructive",
    explanation:
      "Missing Not At Random — la probabilité de manque dépend de la valeur manquante elle-même. Cas le plus critique : nécessite une modélisation explicite du mécanisme.",
  },
}

export default function MissingTab() {
  const { data, isLoading, error } = useMissing()

  const serviceRows = useMemo(() => {
    if (!data) return []
    return Object.entries(data.perServiceMissingPct)
      .map(([service, pct]) => ({ service, pct }))
      .sort((a, b) => b.pct - a.pct)
  }, [data])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        <Skeleton className="h-[280px]" />
      </div>
    )
  }
  if (error || !data) {
    return <EmptyState title="Impossible de charger l'analyse des données manquantes" />
  }

  const info = MECHANISM_INFO[data.mechanismHint] ?? {
    badge: "warning" as const,
    explanation: `Mécanisme détecté : ${data.mechanismHint}`,
  }
  const missingPctGlobal = data.calendarDaysExpected > 0
    ? (data.missingDays / data.calendarDaysExpected) * 100
    : 0

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* KPIs */}
      <section aria-label="Vue synthétique" className="grid grid-cols-1 sm:grid-cols-3 gap-3 lg:gap-4">
        <KpiCard
          label="Jours calendaires attendus"
          value={data.calendarDaysExpected}
          sub="Sur la période analysée"
          icon={CalendarClock}
          tone="default"
        />
        <KpiCard
          label="Jours réels présents"
          value={data.actualDays}
          sub={`${missingPctGlobal.toFixed(1)}% manquant · ${data.missingDays} jour${data.missingDays > 1 ? "s" : ""}`}
          icon={Puzzle}
          tone={data.missingDays === 0 ? "success" : "coral"}
        />
        <KpiCard
          label="Mécanisme heuristique"
          value={<span className="text-base">{data.mechanismHint}</span>}
          sub="Basé sur la corrélation missing ↔ niveau"
          icon={HelpCircle}
          tone={info.badge === "success" ? "success" : info.badge === "warning" ? "coral" : "destructive"}
        />
      </section>

      {/* Verdict */}
      <SectionCard
        title="Mécanisme des données manquantes"
        description="Diagnostic heuristique (MCAR / MAR / MNAR) et recommandations"
        accent={info.badge === "destructive" ? "coral" : "brand"}
        action={<Badge variant={info.badge}>{data.mechanismHint}</Badge>}
      >
        <p className="text-sm text-foreground/85 leading-relaxed">{info.explanation}</p>
      </SectionCard>

      {/* Per-service missing */}
      <SectionCard
        title="Manques par service"
        description="Pourcentage de jours sans données par service · trié décroissant"
      >
        {serviceRows.length === 0 ? (
          <EmptyState title="Aucun service à afficher" />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(240, 40 + serviceRows.length * 32)}>
            <BarChart
              data={serviceRows}
              layout="vertical"
              margin={{ left: 8, right: 32, top: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="oklch(0 0 0 / 0.06)" />
              <XAxis
                type="number"
                domain={[0, 100]}
                tick={{ fontSize: 10, fill: COLOR_MUTED }}
                tickLine={false}
                axisLine={false}
                unit="%"
              />
              <YAxis
                type="category"
                dataKey="service"
                tick={{ fontSize: 10, fill: COLOR_MUTED }}
                tickLine={false}
                axisLine={false}
                width={140}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(v: unknown) => [`${(v as number).toFixed(1)}%`, "Manquant"]}
              />
              <Bar dataKey="pct" radius={[0, 6, 6, 0]}>
                {serviceRows.map((r, i) => (
                  <Cell
                    key={i}
                    fill={
                      r.pct < 10 ? COLOR_SUCCESS
                        : r.pct < 40 ? "oklch(0.75 0.15 78)"
                        : r.pct < 80 ? COLOR_CORAL
                        : "oklch(0.60 0.22 25)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px]">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: COLOR_SUCCESS }} /> {"< 10% (OK)"}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: "oklch(0.75 0.15 78)" }} /> {"10-40% (à surveiller)"}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: COLOR_CORAL }} /> {"40-80% (critique)"}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: "oklch(0.60 0.22 25)" }} /> {"> 80% (quasi vide)"}</span>
        </div>
      </SectionCard>

      {/* Gap timeline */}
      {data.gaps.length > 0 && (
        <SectionCard
          title="Gaps calendaires détectés"
          description={`${data.gaps.length} trou${data.gaps.length > 1 ? "s" : ""} dans la série journalière`}
        >
          <ul className="space-y-1.5">
            {data.gaps.map((g, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden className="h-2 w-2 rounded-full bg-[color:var(--accent-coral)]" />
                  <span className="font-medium tabular-nums">{g.start} → {g.end}</span>
                </div>
                <Badge variant="coral" size="sm">{g.days} jour{g.days > 1 ? "s" : ""}</Badge>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  )
}

"use client"

import {
  AreaChart, Area, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { TrendingUp, AlertTriangle, DollarSign, Activity } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useKPI, useDaily, useServices, useAnomalies } from "@/lib/hooks/useApi"

const SERVICE_COLORS = [
  "#1a6cf6", "#0891b2", "#7c3aed", "#059669", "#d97706", "#dc2626", "#64748b", "#0d9488",
]

function KPICard({
  label, value, sub, icon: Icon, highlight,
}: {
  label: string; value: string; sub?: string; icon: React.ElementType; highlight?: boolean
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-[oklch(0.48_0.24_264)] via-[oklch(0.60_0.18_195)] to-transparent" />
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardDescription className="text-xs font-medium uppercase tracking-wider">{label}</CardDescription>
          <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${highlight ? "bg-destructive/10" : "bg-primary/8"}`}>
            <Icon className={`h-3.5 w-3.5 ${highlight ? "text-destructive" : "text-primary"}`} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />
}

export default function DashboardPage() {
  const { data: kpi, isLoading: kpiLoading } = useKPI()
  const { data: daily, isLoading: dailyLoading } = useDaily(60)
  const { data: services, isLoading: servicesLoading } = useServices()
  const { data: anomalies, isLoading: anomaliesLoading } = useAnomalies()

  const detectedAnomalies = anomalies?.filter((a) => a.isAnomaly) ?? []

  return (
    <PageShell
      title="Vue d'ensemble"
      description={kpi ? `Coûts GCP · ${kpi.periodStart} – ${kpi.periodEnd} · ${kpi.dataPoints} jours` : "Coûts GCP · chargement…"}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {(kpiLoading || !kpi) ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <KPICard
              label="Dépense totale"
              value={`${kpi.totalSpend.toLocaleString("fr-FR", { minimumFractionDigits: 0 })} €`}
              sub="Période complète"
              icon={DollarSign}
            />
            <KPICard
              label="Moyenne quotidienne"
              value={`${kpi.dailyAvg.toFixed(2)} €/j`}
              sub={`Tendance ${kpi.trendSlope >= 0 ? "+" : ""}${kpi.trendSlope.toFixed(4)} €/j`}
              icon={TrendingUp}
            />
            <KPICard
              label="Prévision 30 j"
              value={`${kpi.forecastNext30.toFixed(0)} €`}
              sub="Moyenne 14 derniers jours × 30"
              icon={Activity}
            />
            <KPICard
              label="Anomalies"
              value={`${kpi.anomalyCount} jours`}
              sub="Z-score > 2"
              icon={AlertTriangle}
              highlight
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tendance quotidienne</CardTitle>
            <CardDescription>Coût brut + MA 7 jours + IC 95%</CardDescription>
          </CardHeader>
          <CardContent>
            {(dailyLoading || !daily) ? (
              <Skeleton className="h-[240px] lg:h-[280px]" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={daily} margin={{ left: -20, right: 8 }}>
                  <defs>
                    <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1a6cf6" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#1a6cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} tick={{ fontSize: 10 }} tickLine={false} interval={9} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} unit=" €" width={56} />
                  <Tooltip formatter={(v: number, n: string) => [`${v.toFixed(2)} €`, n]} labelFormatter={(l) => `Date : ${l}`} />
                  <Area type="monotone" dataKey="ciHigh" stroke="none" fill="url(#ciGrad)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="ciLow" stroke="none" fill="white" isAnimationActive={false} />
                  <Line type="monotone" dataKey="cost" stroke="#94a3b8" strokeWidth={1.5} dot={false} name="Coût" />
                  <Line type="monotone" dataKey="ma7" stroke="#1a6cf6" strokeWidth={2} dot={false} name="MA7" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Répartition services</CardTitle>
            <CardDescription>Part de dépense totale</CardDescription>
          </CardHeader>
          <CardContent>
            {(servicesLoading || !services) ? (
              <Skeleton className="h-[180px]" />
            ) : (
              <div className="space-y-2 mt-1">
                {services.slice(0, 6).map((s, i) => (
                  <div key={s.service} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="truncate max-w-[130px] text-muted-foreground">{s.service}</span>
                      <span className="tabular-nums font-semibold text-foreground">{s.pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${s.pct}%`, backgroundColor: SERVICE_COLORS[i] }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Anomalies détectées</CardTitle>
            <CardDescription>Jours avec Z-score &gt; 2 ({detectedAnomalies.length} sur la période)</CardDescription>
          </CardHeader>
          <CardContent>
            {(anomaliesLoading || !anomalies) ? (
              <Skeleton className="h-[100px]" />
            ) : detectedAnomalies.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
                <span className="font-medium">Aucune anomalie détectée</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {detectedAnomalies.map((a) => (
                  <div key={a.date} className="flex items-center justify-between rounded-lg bg-destructive/8 border border-destructive/15 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                      <span className="font-medium text-xs">{a.date}</span>
                    </div>
                    <div className="text-right tabular-nums text-xs">
                      <span className="font-bold">{a.cost.toFixed(0)} €</span>
                      <span className="ml-2 text-muted-foreground">Z={a.zscore.toFixed(1)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Volatilité par service</CardTitle>
            <CardDescription>Coefficient de variation (%)</CardDescription>
          </CardHeader>
          <CardContent>
            {(servicesLoading || !services) ? (
              <Skeleton className="h-[180px]" />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={services.slice(0, 6)} layout="vertical" margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} unit="%" />
                  <YAxis type="category" dataKey="service" tick={{ fontSize: 9 }} tickLine={false} width={75} />
                  <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "CV"]} />
                  <Bar dataKey="cv" radius={[0, 4, 4, 0]}>
                    {services.slice(0, 6).map((_, i) => (
                      <Cell key={i} fill={SERVICE_COLORS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}

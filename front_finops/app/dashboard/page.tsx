"use client"

import {
  AreaChart, Area, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { TrendingUp, AlertTriangle, DollarSign, Activity } from "lucide-react"
import PageShell from "@/components/layout/PageShell"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { DAILY_DATA, SERVICE_SHARES, KPI_DATA, ANOMALY_DATA } from "@/lib/mockData"

const SERVICE_COLORS = [
  "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#d97706", "#dc2626", "#64748b",
]

function KPICard({
  label,
  value,
  sub,
  icon: Icon,
  highlight,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  highlight?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardDescription>{label}</CardDescription>
          <Icon className={`h-4 w-4 ${highlight ? "text-destructive" : "text-muted-foreground"}`} />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

const recentDays = DAILY_DATA.slice(-60)
const anomalies = ANOMALY_DATA.filter((d) => d.isAnomaly)

export default function DashboardPage() {
  return (
    <PageShell
      title="Vue d'ensemble"
      description="Coûts GCP · janvier – juin 2026 · 170 jours"
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          label="Dépense totale"
          value={`${KPI_DATA.totalSpend.toLocaleString("fr-FR", { minimumFractionDigits: 0 })} €`}
          sub="Période complète"
          icon={DollarSign}
        />
        <KPICard
          label="Moyenne quotidienne"
          value={`${KPI_DATA.dailyAvg.toFixed(2)} €/j`}
          sub={`Tendance +${KPI_DATA.trend.toFixed(4)} €/j`}
          icon={TrendingUp}
        />
        <KPICard
          label="Prévision 30 jours"
          value={`${KPI_DATA.forecastNext30} €`}
          sub="AutoETS — MAPE 23.9%"
          icon={Activity}
        />
        <KPICard
          label="Anomalies détectées"
          value={`${KPI_DATA.anomalyCount} jours`}
          sub="Z-score > 2"
          icon={AlertTriangle}
          highlight
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tendance quotidienne</CardTitle>
            <CardDescription>Coût brut + Moyenne mobile 7 jours + bandes IC 95%</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={recentDays} margin={{ left: -8, right: 8 }}>
                <defs>
                  <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => v.slice(5)}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  interval={9}
                />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} unit=" €" />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toFixed(2)} €`, name]}
                  labelFormatter={(l) => `Date : ${l}`}
                />
                <Area
                  type="monotone"
                  dataKey="ciHigh"
                  stroke="none"
                  fill="url(#ciGrad)"
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="ciLow"
                  stroke="none"
                  fill="white"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="cost"
                  stroke="#94a3b8"
                  strokeWidth={1}
                  dot={false}
                  name="Coût"
                />
                <Line
                  type="monotone"
                  dataKey="ma7"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={false}
                  name="MA7"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Répartition par service</CardTitle>
            <CardDescription>Part de dépense totale</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5 mt-1">
              {SERVICE_SHARES.slice(0, 6).map((s, i) => (
                <div key={s.service} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="truncate max-w-[140px]">{s.service}</span>
                    <span className="tabular-nums font-medium">{s.pct.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${s.pct}%`, backgroundColor: SERVICE_COLORS[i] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Anomalies</CardTitle>
            <CardDescription>Jours avec Z-score &gt; 2 ({anomalies.length} détectées)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {anomalies.map((a) => (
                <div
                  key={a.date}
                  className="flex items-center justify-between rounded-lg bg-destructive/10 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    <span className="font-medium">{a.date}</span>
                  </div>
                  <div className="text-right tabular-nums">
                    <span className="font-semibold">{a.cost.toFixed(2)} €</span>
                    <span className="ml-2 text-xs text-muted-foreground">Z={a.zscore.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Volatilité par service</CardTitle>
            <CardDescription>Coefficient de variation (%)</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={SERVICE_SHARES.slice(0, 6)}
                layout="vertical"
                margin={{ left: 4, right: 16 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} unit="%" />
                <YAxis
                  type="category"
                  dataKey="service"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  width={80}
                />
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "CV"]} />
                <Bar dataKey="cv" radius={[0, 4, 4, 0]}>
                  {SERVICE_SHARES.slice(0, 6).map((_, i) => (
                    <Cell key={i} fill={SERVICE_COLORS[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}

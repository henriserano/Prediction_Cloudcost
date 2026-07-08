"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  LineChart,
  Layers,
  FlaskConical,
  DatabaseZap,
  Microscope,
  MessageCircle,
  X,
  Sparkles,
  LogOut,
  User as UserIcon,
  Database,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/lib/context/sidebar-context"
import { useModelBenchmarks } from "@/lib/hooks/useApi"
import { useAuth } from "@/lib/context/auth-context"
import { api } from "@/lib/api"
import { SiaLogo } from "@/components/ui/logo"

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  hint?: string
}

const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Vue d'ensemble", icon: BarChart3, hint: "KPIs & tendances" },
  { href: "/forecast", label: "Prévision", icon: LineChart, hint: "6 modèles" },
  { href: "/services", label: "Services", icon: Layers, hint: "Pareto 80/20" },
  { href: "/analytics", label: "Analytique", icon: FlaskConical, hint: "STL · Anomalies" },
  { href: "/diagnostics", label: "Diagnostics", icon: Microscope, hint: "Anomalies · Drift · Ensemble" },
  { href: "/assistant", label: "Assistant", icon: MessageCircle, hint: "Chat FinOps" },
]

const SECONDARY: NavItem[] = [
  { href: "/data-sources", label: "Sources de données", icon: DatabaseZap, hint: "Import · Cloud" },
]

export default function Sidebar() {
  const path = usePathname()
  const { open, close } = useSidebar()
  const { data: benchmarks } = useModelBenchmarks()
  const bestModel = benchmarks?.find((m) => m.winner)?.model ?? "AutoETS"
  const { user, logout } = useAuth()
  const { data: dataStatus } = useQuery<{
    source: string
    rowsDaily: number
    servicesCount: number
    periodStart: string | null
    periodEnd: string | null
  }>({
    queryKey: ["data-status"],
    queryFn: () => api.get("/api/data/status").then((r) => r.data),
    // Poll every 30s so the badge picks up an AWS sync triggered from another
    // tab; the panel that triggers it also does an explicit invalidate.
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const sourceLabel = (() => {
    if (!dataStatus) return "…"
    if (dataStatus.source === "events") return "Live"
    if (dataStatus.source === "parquet_fallback") return "Démo"
    if (dataStatus.source === "empty") return "Vide"
    return dataStatus.source
  })()
  const sourceActive = dataStatus?.source === "events"

  const isActive = (href: string) => path === href || path.startsWith(href + "/")

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-dvh w-72 flex-col",
          "bg-sidebar text-sidebar-foreground",
          "transition-transform duration-300 ease-in-out",
          "lg:static lg:h-screen lg:w-64 lg:translate-x-0 lg:shrink-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        aria-label="Navigation principale"
      >
        {/* Ambient corail gradient */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[color:var(--accent-coral)]/12 to-transparent"
        />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 py-5">
          <SiaLogo />
          <button
            onClick={close}
            className="lg:hidden rounded-lg p-1.5 text-sidebar-foreground/70 hover:bg-white/8 hover:text-white transition-colors"
            aria-label="Fermer la navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Section title */}
        <p className="px-5 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40">
          Analyse
        </p>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Sections principales">
          <ul className="space-y-0.5">
            {PRIMARY.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={close} />
            ))}
          </ul>

          <p className="mt-6 px-2 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/40">
            Configuration
          </p>
          <ul className="space-y-0.5">
            {SECONDARY.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={close} />
            ))}
          </ul>
        </nav>

        {/* Footer info */}
        <div className="border-t border-sidebar-border px-4 py-3 space-y-2">
          {user && (
            <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 backdrop-blur-sm ring-1 ring-white/5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10">
                <UserIcon className="h-3.5 w-3.5 text-sidebar-foreground/70" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-semibold text-white">
                  {user.displayName}
                </p>
                <p className="text-[10px] text-sidebar-foreground/45">
                  {user.hasCredentials ? "Coffre actif" : "Aucun compte lié"}
                </p>
              </div>
              <button
                onClick={() => void logout()}
                className="rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Se déconnecter"
                title="Se déconnecter"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="rounded-lg bg-white/5 px-3 py-2.5 backdrop-blur-sm ring-1 ring-white/5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[10px] text-sidebar-foreground/50 uppercase tracking-widest font-semibold">
                Source données
              </p>
              <Database
                className={cn(
                  "h-3 w-3",
                  sourceActive
                    ? "text-emerald-400"
                    : "text-sidebar-foreground/40",
                )}
                aria-hidden
              />
            </div>
            <p className="text-xs text-white font-semibold truncate">{sourceLabel}</p>
            <p className="text-[10px] text-sidebar-foreground/40 mt-0.5">
              {dataStatus?.periodStart && dataStatus?.periodEnd
                ? `${dataStatus.periodStart} → ${dataStatus.periodEnd}`
                : `${dataStatus?.rowsDaily ?? 0} points · ${dataStatus?.servicesCount ?? 0} services`}
            </p>
          </div>
          <div className="rounded-lg bg-white/5 px-3 py-2.5 backdrop-blur-sm ring-1 ring-white/5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[10px] text-sidebar-foreground/50 uppercase tracking-widest font-semibold">
                Modèle actif
              </p>
              <Sparkles className="h-3 w-3 text-[color:var(--accent-coral)]" aria-hidden />
            </div>
            <p className="text-xs text-white font-semibold truncate">{bestModel}</p>
            <p className="text-[10px] text-sidebar-foreground/40 mt-0.5">
              {dataStatus?.periodStart && dataStatus?.periodEnd
                ? `${dataStatus.periodStart} – ${dataStatus.periodEnd}`
                : "Jan – Juin 2026"}
            </p>
          </div>

          <p className="text-[10px] text-sidebar-foreground/35 px-1">
            Powered by <span className="text-sidebar-foreground/60 font-semibold">Sia</span>
          </p>
        </div>
      </aside>
    </>
  )
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate: () => void
}) {
  const Icon = item.icon
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all",
          active
            ? "bg-white/8 text-white"
            : "text-sidebar-foreground/65 hover:bg-white/5 hover:text-white"
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-[color:var(--accent-coral)]"
          />
        )}
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            active
              ? "text-[color:var(--accent-coral)]"
              : "text-sidebar-foreground/45 group-hover:text-white"
          )}
        />
        <span className="flex-1 truncate">{item.label}</span>
        {item.hint && (
          <span className="hidden xl:inline text-[10px] text-sidebar-foreground/30 group-hover:text-sidebar-foreground/60">
            {item.hint}
          </span>
        )}
      </Link>
    </li>
  )
}

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
          "shadow-[var(--shadow-sia-ambient)]",
          "transition-transform duration-300 ease-in-out",
          "lg:static lg:h-screen lg:w-64 lg:translate-x-0 lg:shrink-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
        aria-label="Navigation principale"
      >
        {/* Header */}
        <div className="relative flex items-center justify-between px-5 py-5">
          <SiaLogo onLight />
          <button
            onClick={close}
            className="lg:hidden rounded-lg p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
            aria-label="Fermer la navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Section title */}
        <p className="px-5 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/70">
          Analyse
        </p>

        {/* Primary nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Sections principales">
          <ul className="space-y-0.5">
            {PRIMARY.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={close} />
            ))}
          </ul>

          <p className="mt-6 px-2 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/70">
            Configuration
          </p>
          <ul className="space-y-0.5">
            {SECONDARY.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} onNavigate={close} />
            ))}
          </ul>
        </nav>

        {/* Footer info — depth via subtle Sia-card shadow, no borders. */}
        <div className="px-4 py-3 space-y-2">
          {user && (
            <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 shadow-[var(--shadow-sia-card)]">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sidebar-foreground/8">
                <UserIcon className="h-3.5 w-3.5 text-sidebar-foreground/80" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-semibold text-sidebar-foreground">
                  {user.displayName}
                </p>
                <p className="text-[10px] text-sidebar-foreground/85">
                  {user.hasCredentials ? "Coffre actif" : "Aucun compte lié"}
                </p>
              </div>
              <button
                onClick={() => void logout()}
                className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                aria-label="Se déconnecter"
                title="Se déconnecter"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="rounded-lg bg-white px-3 py-2.5 shadow-[var(--shadow-sia-card)]">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[10px] text-sidebar-foreground/85 uppercase tracking-widest font-semibold">
                Source données
              </p>
              <Database
                className={cn(
                  "h-3 w-3",
                  sourceActive
                    ? "text-[color:var(--accent-green)]"
                    : "text-sidebar-foreground/70",
                )}
                aria-hidden
              />
            </div>
            <p className="text-xs text-sidebar-foreground font-semibold truncate">{sourceLabel}</p>
            <p className="text-[10px] text-sidebar-foreground/70 mt-0.5">
              {dataStatus?.periodStart && dataStatus?.periodEnd
                ? `${dataStatus.periodStart} → ${dataStatus.periodEnd}`
                : `${dataStatus?.rowsDaily ?? 0} points · ${dataStatus?.servicesCount ?? 0} services`}
            </p>
          </div>
          <div className="rounded-lg bg-white px-3 py-2.5 shadow-[var(--shadow-sia-card)]">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[10px] text-sidebar-foreground/85 uppercase tracking-widest font-semibold">
                Modèle actif
              </p>
              <Sparkles className="h-3 w-3 text-[color:var(--accent-green)]" aria-hidden />
            </div>
            <p className="text-xs text-sidebar-foreground font-semibold truncate">{bestModel}</p>
            <p className="text-[10px] text-sidebar-foreground/70 mt-0.5">
              {dataStatus?.periodStart && dataStatus?.periodEnd
                ? `${dataStatus.periodStart} – ${dataStatus.periodEnd}`
                : "Jan – Juin 2026"}
            </p>
          </div>

          <p className="text-[10px] text-sidebar-foreground/70 px-1">
            Powered by{" "}
            <span className="font-heading font-semibold tracking-[-0.02em] text-sidebar-foreground/80">
              sia<span className="text-[color:var(--accent-green)]">.</span>
            </span>
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
        title={item.hint}
        className={cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold leading-tight transition-all",
          active
            ? "bg-white text-sidebar-foreground shadow-[var(--shadow-sia-card)]"
            : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-[color:var(--accent-green)]"
          />
        )}
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            active
              ? "text-[color:var(--accent-green)]"
              : "text-sidebar-foreground/80 group-hover:text-sidebar-foreground",
          )}
        />
        <span className="min-w-0 flex-1 whitespace-nowrap">{item.label}</span>
      </Link>
    </li>
  )
}

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LineChart,
  DatabaseZap,
  MessageCircle,
  X,
  Sparkles,
  LogOut,
  User as UserIcon,
  Database,
  Compass,
  BarChartBig,
  Briefcase,
  Lightbulb,
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
  badge?: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

// Sidebar navigation grouped in 4 semantic sections. The layout mirrors the
// FinOps journey: define what you want (estimation), collect what you have,
// understand the picture, then decide what to do about it.
const SECTIONS: NavSection[] = [
  {
    title: "Estimation projet",
    items: [
      { href: "/cadrage", label: "Estimation projet", icon: Compass, hint: "Simuler avant lancement" },
    ],
  },
  {
    title: "Collecte",
    items: [
      { href: "/collecte", label: "Collecte", icon: DatabaseZap, hint: "Fichier · Multi-cloud" },
      { href: "/portefeuille", label: "Portefeuille", icon: Briefcase, hint: "Vision consolidée" },
    ],
  },
  {
    title: "Comprendre",
    items: [
      { href: "/analyse", label: "Analyse", icon: BarChartBig, hint: "Flux & dépenses" },
      { href: "/projection", label: "Projection", icon: LineChart, hint: "Prévision de dépenses" },
    ],
  },
  {
    title: "Diagnostic",
    items: [
      { href: "/assistant", label: "Assistant", icon: MessageCircle, hint: "Chat FinOps" },
      { href: "/optimiser", label: "Optimiser", icon: Lightbulb, hint: "Recommandations", badge: "Bientôt" },
    ],
  },
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

        {/* Grouped navigation — each SECTIONS entry renders its own labelled
            block so the FinOps journey stays readable at a glance. */}
        <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-4" aria-label="Sections principales">
          {SECTIONS.map((section, i) => (
            <div key={section.title} className={i > 0 ? "mt-5" : undefined}>
              <p className="px-2 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/70">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isActive(item.href)}
                    onNavigate={close}
                  />
                ))}
              </ul>
            </div>
          ))}
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
        {item.badge && (
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
              active
                ? "bg-[color:var(--accent-green)]/15 text-[color:var(--accent-green)]"
                : "bg-sidebar-foreground/10 text-sidebar-foreground/70",
            )}
          >
            {item.badge}
          </span>
        )}
      </Link>
    </li>
  )
}

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart2, LineChart, Layers, FlaskConical, X, CloudCog } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/lib/context/sidebar-context"

const NAV = [
  { href: "/dashboard", label: "Vue d'ensemble", icon: BarChart2 },
  { href: "/forecast", label: "Prévision", icon: LineChart },
  { href: "/services", label: "Services", icon: Layers },
  { href: "/analytics", label: "Analytique", icon: FlaskConical },
]

export default function Sidebar() {
  const path = usePathname()
  const { open, close } = useSidebar()

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={close}
        aria-hidden="true"
      />

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-screen w-64 flex flex-col",
          "bg-[oklch(0.10_0.10_264)] text-white",
          "transition-transform duration-300 ease-in-out",
          "lg:static lg:translate-x-0 lg:shrink-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[oklch(0.48_0.24_264)] shadow-sm shadow-blue-900/30">
              <CloudCog className="h-4 w-4 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight">FinOps</p>
              <p className="text-[11px] text-white/45 font-normal">demo GCP</p>
            </div>
          </div>
          <button
            onClick={close}
            className="lg:hidden rounded-lg p-1.5 hover:bg-white/10 transition-colors"
            aria-label="Fermer le menu"
          >
            <X className="h-4 w-4 text-white/70" />
          </button>
        </div>

        {/* Sia brand accent stripe */}
        <div className="h-px bg-gradient-to-r from-[oklch(0.48_0.24_264)] via-[oklch(0.60_0.18_195)] to-transparent" />

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = path === href || path.startsWith(href + "/")
            return (
              <Link
                key={href}
                href={href}
                onClick={close}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-[oklch(0.48_0.24_264)] text-white shadow-sm"
                    : "text-white/60 hover:bg-white/8 hover:text-white"
                )}
              >
                <Icon className={cn(
                  "h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-110",
                  active ? "text-white" : "text-white/45 group-hover:text-white"
                )} />
                <span>{label}</span>
                {active && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white/60" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Info footer */}
        <div className="px-4 pb-2 space-y-2">
          <div className="rounded-lg bg-white/5 px-3 py-2.5">
            <p className="text-[10px] text-white/35 uppercase tracking-widest font-semibold mb-0.5">Période</p>
            <p className="text-xs text-white/70">Jan – Juin 2026</p>
          </div>
          <div className="rounded-lg bg-[oklch(0.48_0.24_264)]/20 border border-[oklch(0.48_0.24_264)]/20 px-3 py-2.5">
            <p className="text-[10px] text-[oklch(0.70_0.16_264)] uppercase tracking-widest font-semibold mb-0.5">Modèle actif</p>
            <p className="text-xs text-white font-semibold">AutoETS</p>
          </div>
        </div>

        {/* Powered by */}
        <div className="px-5 py-3 border-t border-white/8">
          <p className="text-[10px] text-white/25">
            Powered by <span className="text-white/45 font-semibold">Sia Partners</span>
          </p>
        </div>
      </aside>
    </>
  )
}

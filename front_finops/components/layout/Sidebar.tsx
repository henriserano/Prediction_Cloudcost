"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart2, LineChart, Layers, FlaskConical, CloudCog } from "lucide-react"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/dashboard", label: "Vue d'ensemble", icon: BarChart2 },
  { href: "/forecast", label: "Prévision", icon: LineChart },
  { href: "/services", label: "Services", icon: Layers },
  { href: "/analytics", label: "Analytique", icon: FlaskConical },
]

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-sidebar text-sidebar-foreground shrink-0">
      <div className="flex items-center gap-2 px-5 py-5 border-b">
        <CloudCog className="h-5 w-5 text-sidebar-primary" />
        <span className="font-semibold text-sm leading-tight">
          FinOps<br />
          <span className="text-muted-foreground font-normal">demo GCP</span>
        </span>
      </div>
      <nav className="flex-1 py-4 px-2 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              path === href
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>
      <div className="px-4 py-3 border-t text-xs text-muted-foreground">
        Données : jan – juin 2026<br />
        Modèle actif : <span className="font-medium text-foreground">AutoETS</span>
      </div>
    </aside>
  )
}

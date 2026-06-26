"use client"

import React from "react"
import { Menu } from "lucide-react"
import { useSidebar } from "@/lib/context/sidebar-context"

interface PageShellProps {
  title: string
  description?: string
  children: React.ReactNode
}

export default function PageShell({ title, description, children }: PageShellProps) {
  const { toggle } = useSidebar()

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-auto bg-[oklch(0.978_0.006_240)]">
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-white px-4 py-3 shadow-sm shrink-0">
        <button
          onClick={toggle}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted transition-colors"
          aria-label="Ouvrir le menu"
        >
          <Menu className="h-5 w-5 text-foreground" />
        </button>
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-foreground truncate">{title}</h1>
        </div>
        <div className="ml-auto flex h-6 w-6 items-center justify-center rounded bg-[oklch(0.22_0.18_264)]">
          <span className="text-[8px] font-bold text-white leading-none">FO</span>
        </div>
      </div>

      {/* Desktop header */}
      <header className="hidden lg:block px-8 py-6 border-b border-border bg-white shrink-0">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">{title}</h1>
            {description && (
              <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-[oklch(0.48_0.24_264)]/30 bg-[oklch(0.48_0.24_264)]/8 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs font-medium text-[oklch(0.35_0.18_264)]">Live</span>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 lg:px-8 lg:py-6 space-y-4 lg:space-y-6">
        {children}
      </main>
    </div>
  )
}

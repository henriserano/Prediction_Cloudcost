"use client"

import * as React from "react"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

type Tone = "info" | "success" | "warning" | "destructive"

interface ExplainProps {
  title: string
  children: React.ReactNode
  tone?: Tone
  side?: "top" | "bottom"
  align?: "start" | "center" | "end"
  triggerClassName?: string
  size?: "sm" | "md" | "lg"
}

const TRIGGER_TONE: Record<Tone, string> = {
  info: "text-brand-foreground/60 hover:text-[color:var(--brand)] hover:bg-brand/10",
  success: "text-[color:var(--success)]/70 hover:text-[color:var(--success)] hover:bg-[color:var(--success)]/10",
  warning: "text-[color:var(--accent-coral)]/70 hover:text-[color:var(--accent-coral)] hover:bg-[color:var(--accent-coral)]/10",
  destructive: "text-destructive/70 hover:text-destructive hover:bg-destructive/10",
}

const HEADER_TONE: Record<Tone, string> = {
  info: "text-[color:var(--brand)]",
  success: "text-[color:var(--success)]",
  warning: "text-[color:var(--accent-coral)]",
  destructive: "text-destructive",
}

const SIZE: Record<"sm" | "md" | "lg", string> = {
  sm: "w-56",
  md: "w-72",
  lg: "w-96",
}

/**
 * Educational popover: renders a small info icon that reveals a contextual
 * explanation on hover, focus, or tap. Use for metric definitions and verdict
 * interpretation.
 *
 * Content convention: pass children with a short definition first, then a
 * `<Verdict>` block for the contextual reading of the current value.
 */
export function Explain({
  title,
  children,
  tone = "info",
  side = "bottom",
  align = "center",
  triggerClassName,
  size = "md",
}: ExplainProps) {
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLSpanElement>(null)

  // Close on outside click (mobile tap-outside)
  React.useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <span
      ref={containerRef}
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`Explication : ${title}`}
        aria-expanded={open}
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-full transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-coral)]/40",
          TRIGGER_TONE[tone],
          triggerClassName
        )}
      >
        <Info className="h-2.5 w-2.5" strokeWidth={2.75} aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 rounded-xl border border-border bg-card p-3.5 shadow-lg pointer-events-auto",
            SIZE[size],
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
            align === "start" && "left-0",
            align === "center" && "left-1/2 -translate-x-1/2",
            align === "end" && "right-0"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <p className={cn(
            "font-semibold text-[13px] mb-2 flex items-center gap-1.5",
            HEADER_TONE[tone]
          )}>
            <Info className="h-3 w-3 shrink-0" aria-hidden />
            {title}
          </p>
          <div className="space-y-2 text-[11.5px] text-foreground/80 leading-relaxed">
            {children}
          </div>
        </span>
      )}
    </span>
  )
}

/**
 * Contextual verdict inside an <Explain> — highlights the current reading
 * of the metric given the actual data.
 */
export function Verdict({
  tone = "info",
  children,
}: {
  tone?: Tone
  children: React.ReactNode
}) {
  const bg: Record<Tone, string> = {
    info: "bg-brand/8 border-brand/15 text-foreground",
    success: "bg-[color:var(--success)]/10 border-[color:var(--success)]/20 text-[color:var(--success)]",
    warning: "bg-[color:var(--accent-coral)]/8 border-[color:var(--accent-coral)]/20 text-[color:var(--accent-coral)]",
    destructive: "bg-destructive/8 border-destructive/20 text-destructive",
  }
  return (
    <div className={cn("rounded-lg border px-2.5 py-2 text-[11.5px] leading-relaxed", bg[tone])}>
      <p className="font-semibold text-[10.5px] uppercase tracking-widest mb-0.5 opacity-70">
        Votre résultat
      </p>
      {children}
    </div>
  )
}

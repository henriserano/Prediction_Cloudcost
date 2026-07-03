"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

type Tone = "info" | "success" | "warning" | "destructive"

interface ExplainProps {
  title: string
  children: React.ReactNode
  tone?: Tone
  size?: "sm" | "md" | "lg"
  triggerClassName?: string
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

// Requested widths (px). Actual width is min(requested, viewport - margins).
const SIZE_PX: Record<"sm" | "md" | "lg", number> = {
  sm: 224,
  md: 288,
  lg: 384,
}

const VIEWPORT_MARGIN = 12 // px of breathing room on each side

interface FloatPosition {
  top: number
  left: number
  width: number
  arrowLeft: number
  side: "top" | "bottom"
}

/**
 * Educational popover: renders a small info icon that reveals a contextual
 * explanation on hover, focus, or tap. The popover is rendered through a
 * React Portal to escape parent overflow, and its position is clamped to
 * the viewport so it never gets clipped.
 */
export function Explain({
  title,
  children,
  tone = "info",
  size = "md",
  triggerClassName,
}: ExplainProps) {
  const [open, setOpen] = React.useState(false)
  const [pos, setPos] = React.useState<FloatPosition | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => setMounted(true), [])

  const computePosition = React.useCallback((): FloatPosition | null => {
    const trigger = triggerRef.current
    if (!trigger) return null
    const rect = trigger.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Desired width, capped by viewport width minus margins
    const desiredW = SIZE_PX[size]
    const width = Math.min(desiredW, vw - VIEWPORT_MARGIN * 2)

    // Prefer below unless there isn't room; assume popover height ~200px estimate
    // (we can't measure until rendered, so we use a conservative estimate; the
    // popover has max-height with scroll if needed).
    const estimatedH = 240
    const spaceBelow = vh - rect.bottom
    const side: "top" | "bottom" = spaceBelow >= estimatedH ? "bottom" : "top"
    const gap = 6

    const top = side === "bottom" ? rect.bottom + gap : rect.top - gap - estimatedH
    // Ideally center horizontally on the trigger, but clamp to viewport bounds
    const triggerCenter = rect.left + rect.width / 2
    let left = triggerCenter - width / 2
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - width - VIEWPORT_MARGIN))
    // Arrow position relative to the popover's own coord system
    const arrowLeft = triggerCenter - left

    return { top, left, width, arrowLeft, side }
  }, [size])

  const openPopover = React.useCallback(() => {
    setOpen(true)
    setPos(computePosition())
  }, [computePosition])

  const closePopover = React.useCallback(() => {
    setOpen(false)
  }, [])

  // Close on outside click, escape, scroll, resize
  React.useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!triggerRef.current?.contains(e.target as Node)) {
        // Also allow clicks inside the popover itself (which is portalled) via a data attribute check
        const target = e.target as HTMLElement | null
        if (target?.closest("[data-explain-popover]")) return
        closePopover()
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePopover()
    }
    function onScroll() { closePopover() }
    function onResize() { closePopover() }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onResize)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onResize)
    }
  }, [open, closePopover])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={openPopover}
        onMouseLeave={closePopover}
        onFocus={openPopover}
        onBlur={closePopover}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (open) closePopover()
          else openPopover()
        }}
        aria-label={`Explication : ${title}`}
        aria-expanded={open}
        className={cn(
          "inline-flex h-4 w-4 items-center justify-center rounded-full transition-all align-middle shrink-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-coral)]/40",
          TRIGGER_TONE[tone],
          triggerClassName
        )}
      >
        <Info className="h-2.5 w-2.5" strokeWidth={2.75} aria-hidden />
      </button>

      {mounted && open && pos && createPortal(
        <div
          data-explain-popover
          role="tooltip"
          onMouseEnter={openPopover}
          onMouseLeave={closePopover}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: "min(60vh, 420px)",
            zIndex: 60,
          }}
          className="rounded-xl border border-border bg-card p-3.5 shadow-lg overflow-y-auto animate-in fade-in-0 zoom-in-95"
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
        </div>,
        document.body
      )}
    </>
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

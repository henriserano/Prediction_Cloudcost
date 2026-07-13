"use client"

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"

// Shared banners + error helpers used across data collection and cadrage flows.
// Kept at ui/ level (not per-feature) so cross-cutting consumers such as the
// credentials panel don't have to reach into a sibling route's private folder.

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/6 px-3.5 py-3 text-sm text-destructive">
      <XCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-lg border border-[color:var(--success)]/20 bg-[color:var(--success)]/10 px-3.5 py-3 text-sm text-[color:var(--success)]">
      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

export function WarnBanner({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/12 px-3.5 py-3 text-sm text-[color:var(--warning-foreground)]">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

export function extractStatus(err: unknown): number | null {
  if (
    err && typeof err === "object" && "response" in err &&
    err.response && typeof err.response === "object" && "status" in err.response
  ) {
    const s = (err.response as { status?: unknown }).status
    return typeof s === "number" ? s : null
  }
  return null
}

export function extractMessage(err: unknown): string | null {
  if (
    err && typeof err === "object" && "response" in err &&
    err.response && typeof err.response === "object" && "data" in err.response
  ) {
    const data = (err.response as { data?: unknown }).data
    if (data && typeof data === "object" && "detail" in data) {
      const d = (data as { detail?: unknown }).detail
      if (typeof d === "string") return d
    }
  }
  return null
}

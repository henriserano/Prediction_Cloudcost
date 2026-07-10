import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Adaptive currency formatter (French locale).
 * Picks precision + compact notation based on magnitude so a small forecast
 * doesn't render as "0.1k €" and a huge one doesn't render as "1 234 567 €".
 *
 *   0.42     → "0,42 €"
 *   45       → "45 €"
 *   5 250    → "5 250 €"
 *   12 340   → "12,3k €"
 *   1 250 000→ "1,3M €"
 */
export function formatCurrency(value: number, currency = "€"): string {
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  const fmt = (v: number, digits = 0) =>
    v.toLocaleString("fr-FR", { maximumFractionDigits: digits })

  if (abs < 1) return `${fmt(value, 2)} ${currency}`
  if (abs < 10_000) return `${fmt(value)} ${currency}`
  if (abs < 1_000_000) return `${fmt(value / 1_000, 1)}k ${currency}`
  return `${fmt(value / 1_000_000, 1)}M ${currency}`
}

// Shared chart palette + helpers for the Diagnostics page

// Sia chart palette — black, green, sky-deep, blush-deep, gold
// (mirrors --chart-1 … --chart-5 in globals.css)
export const CHART_COLORS = [
  "oklch(0.14 0 0)",         // Sia black
  "oklch(0.68 0.15 160)",     // Sia green
  "oklch(0.65 0.13 240)",    // sky-deep
  "oklch(0.72 0.14 15)",     // blush-deep
  "oklch(0.75 0.15 78)",     // gold
  "oklch(0.62 0.14 155)",    // green
  "oklch(0.48 0.02 250)",    // slate
  "oklch(0.60 0.11 195)",    // teal
]

export const COLOR_BRAND = "oklch(0.14 0 0)"
export const COLOR_GREEN = "oklch(0.68 0.15 160)"
export const COLOR_SKY   = "oklch(0.65 0.13 240)"
export const COLOR_BLUSH = "oklch(0.72 0.14 15)"
export const COLOR_TEAL  = "oklch(0.60 0.11 195)"
export const COLOR_GOLD  = "oklch(0.75 0.15 78)"
export const COLOR_DEST  = "oklch(0.60 0.22 25)"
export const COLOR_MUTED = "oklch(0.65 0.02 250)"
export const COLOR_SUCCESS = "oklch(0.62 0.14 155)"

// Null-safe numeric formatter
export const num = (n: number | null | undefined, d = 2) =>
  n == null || Number.isNaN(n) ? "—" : n.toFixed(d)

// Format a p-value with scientific notation when tiny
export const fmtP = (p: number | null | undefined) => {
  if (p == null || Number.isNaN(p)) return "—"
  if (p === 0) return "< 1e-6"
  if (p < 0.001) return p.toExponential(1)
  return p.toFixed(4)
}

export const chartTooltipStyle = {
  borderRadius: 10,
  border: "1px solid oklch(0.90 0.010 250)",
  fontSize: 12,
  boxShadow: "0 4px 12px oklch(0 0 0 / 0.06)",
}

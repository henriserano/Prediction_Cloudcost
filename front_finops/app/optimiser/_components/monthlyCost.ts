// Shared helper: convert the 6-month cumulative billing (returned by
// usePortfolioAggregate) into a monthly-cost proxy.
//
// The average of the last 3 completed months is preferred over `total / 6`
// because it dampens single-month spikes without lagging like the full window.
// Fallback to `total / months` when `byMonth` is empty (e.g. a fresh member
// or the local events store returning only the total).

export function estimateMonthlyCost(
  byMonth: { month: string; cost: number }[],
  total: number,
  months = 6,
): number {
  if (byMonth.length === 0) return total / Math.max(months, 1)
  const sorted = [...byMonth].sort((a, b) => a.month.localeCompare(b.month))
  const window = sorted.slice(-3)
  const sum = window.reduce((s, m) => s + m.cost, 0)
  return sum / window.length
}

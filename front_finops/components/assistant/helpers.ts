export function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function formatRelative(iso: string): string {
  if (!iso) return ""
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ""
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return "à l'instant"
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `il y a ${diffMin} min`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `il y a ${diffHr} h`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `il y a ${diffDay} j`
  return new Date(then).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  })
}

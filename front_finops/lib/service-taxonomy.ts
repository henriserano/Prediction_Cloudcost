import type { ServiceCategory } from "@/lib/types"

/**
 * UI-side metadata for service categories. Keep aligned with the backend's
 * ``analysis/service_taxonomy.py`` — the backend decides which category a
 * service belongs to, this file only says how to render it.
 *
 * ``bgClass`` uses tailwind arbitrary color values so we don't have to
 * declare custom palette entries; ``dotClass`` is used in legends.
 */
export interface CategoryMeta {
  id: ServiceCategory
  label: string
  short: string
  hex: string
  bgClass: string
  dotClass: string
  textClass: string
}

export const CATEGORY_META: Record<ServiceCategory, CategoryMeta> = {
  compute: {
    id: "compute",
    label: "Compute",
    short: "Cpt",
    hex: "#6366f1",
    bgClass: "bg-indigo-500/10 border-indigo-500/30",
    dotClass: "bg-indigo-500",
    textClass: "text-indigo-600 dark:text-indigo-300",
  },
  database: {
    id: "database",
    label: "Database",
    short: "DB",
    hex: "#0ea5e9",
    bgClass: "bg-sky-500/10 border-sky-500/30",
    dotClass: "bg-sky-500",
    textClass: "text-sky-600 dark:text-sky-300",
  },
  storage: {
    id: "storage",
    label: "Storage",
    short: "Sto",
    hex: "#14b8a6",
    bgClass: "bg-teal-500/10 border-teal-500/30",
    dotClass: "bg-teal-500",
    textClass: "text-teal-600 dark:text-teal-300",
  },
  analytics: {
    id: "analytics",
    label: "Analytics",
    short: "Ana",
    hex: "#f59e0b",
    bgClass: "bg-amber-500/10 border-amber-500/30",
    dotClass: "bg-amber-500",
    textClass: "text-amber-600 dark:text-amber-300",
  },
  ai_ml: {
    id: "ai_ml",
    label: "AI / ML",
    short: "AI",
    hex: "#ec4899",
    bgClass: "bg-pink-500/10 border-pink-500/30",
    dotClass: "bg-pink-500",
    textClass: "text-pink-600 dark:text-pink-300",
  },
  network: {
    id: "network",
    label: "Network",
    short: "Net",
    hex: "#8b5cf6",
    bgClass: "bg-violet-500/10 border-violet-500/30",
    dotClass: "bg-violet-500",
    textClass: "text-violet-600 dark:text-violet-300",
  },
  security: {
    id: "security",
    label: "Security",
    short: "Sec",
    hex: "#ef4444",
    bgClass: "bg-red-500/10 border-red-500/30",
    dotClass: "bg-red-500",
    textClass: "text-red-600 dark:text-red-300",
  },
  observability: {
    id: "observability",
    label: "Observability",
    short: "Obs",
    hex: "#10b981",
    bgClass: "bg-emerald-500/10 border-emerald-500/30",
    dotClass: "bg-emerald-500",
    textClass: "text-emerald-600 dark:text-emerald-300",
  },
  other: {
    id: "other",
    label: "Other",
    short: "Oth",
    hex: "#94a3b8",
    bgClass: "bg-slate-500/10 border-slate-500/30",
    dotClass: "bg-slate-500",
    textClass: "text-slate-600 dark:text-slate-300",
  },
}

export const CATEGORY_ORDER: ServiceCategory[] = [
  "compute",
  "database",
  "storage",
  "analytics",
  "ai_ml",
  "network",
  "security",
  "observability",
  "other",
]

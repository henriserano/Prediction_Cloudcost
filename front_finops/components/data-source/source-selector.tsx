"use client"

import { Briefcase, HardDrive } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Portfolio } from "@/lib/hooks/usePortfolios"

// Shared, fully-controlled source picker: segmented pill "Projet | Portefeuille"
// plus a portfolio dropdown that surfaces when Portefeuille is active.
//
// Both callers (Analyse header, Optimiser header) render this component; their
// wrappers wire state to whichever store makes sense (Analyse → URL params
// for shareable links, Optimiser → local React state). Keeping the visual
// contract in one place is the whole point — the two headers must stay in
// visual lockstep.

export type DataSource = "projet" | "portefeuille"

interface SourceSelectorProps {
  source: DataSource
  onSourceChange: (s: DataSource) => void
  portfolios: Portfolio[]
  portfolioId: string | null
  onPortfolioIdChange: (id: string | null) => void
  /** ``header`` is the compact style used inside PageShell actions; ``inline``
   *  is a larger version for mobile fallbacks below the top bar. */
  variant?: "header" | "inline"
  /** Optional label announced on the segmented group — differs subtly between
   *  Analyse (Source des données) and Optimiser (Source de l'audit). */
  ariaLabel?: string
}

export function SourceSelector({
  source,
  onSourceChange,
  portfolios,
  portfolioId,
  onPortfolioIdChange,
  variant = "header",
  ariaLabel = "Source des données",
}: SourceSelectorProps) {
  const portfolioAvailable = portfolios.length > 0
  const compact = variant === "header"

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        compact ? "flex-nowrap" : "flex-wrap",
      )}
    >
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn(
          "inline-flex rounded-lg border border-border bg-card shadow-sm",
          compact ? "p-0.5" : "p-1",
        )}
      >
        <PickerButton
          active={source === "projet"}
          onClick={() => onSourceChange("projet")}
          compact={compact}
          icon={HardDrive}
          label="Projet"
          hint="Données ingérées"
        />
        <PickerButton
          active={source === "portefeuille"}
          onClick={() => onSourceChange("portefeuille")}
          compact={compact}
          disabled={!portfolioAvailable}
          disabledTitle="Créez un portefeuille depuis la page Portefeuille pour activer cette vue."
          icon={Briefcase}
          label="Portefeuille"
          hint={
            portfolioAvailable
              ? `${portfolios.length} défini${portfolios.length > 1 ? "s" : ""}`
              : "aucun"
          }
        />
      </div>

      {source === "portefeuille" && portfolioAvailable && (
        <select
          value={portfolioId ?? ""}
          onChange={(e) => onPortfolioIdChange(e.target.value || null)}
          aria-label="Portefeuille actif"
          className={cn(
            "rounded-lg border border-border bg-card font-medium focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-green)]/40 max-w-[220px] truncate",
            compact ? "h-8 px-2 text-xs" : "px-3 py-2 text-sm",
          )}
        >
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.members.length} src
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

interface PickerButtonProps {
  active: boolean
  onClick: () => void
  compact: boolean
  disabled?: boolean
  disabledTitle?: string
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  hint: string
}

function PickerButton({
  active,
  onClick,
  compact,
  disabled,
  disabledTitle,
  icon: Icon,
  label,
  hint,
}: PickerButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={disabled ? disabledTitle : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed",
        compact ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm gap-2",
        active
          ? "bg-brand text-brand-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          compact ? "h-3 w-3" : "h-3.5 w-3.5",
          active ? "text-[color:var(--accent-green)]" : "text-muted-foreground",
        )}
        aria-hidden
      />
      <span>{label}</span>
      {!compact && (
        <span
          className={cn(
            "text-[10px] font-medium max-w-[140px] truncate",
            active ? "text-white/60" : "text-muted-foreground/60",
          )}
        >
          {hint}
        </span>
      )}
    </button>
  )
}

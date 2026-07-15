"use client"

import { useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { usePortfolios } from "@/lib/hooks/usePortfolios"
import { SourceSelector, type DataSource } from "@/components/data-source/source-selector"
import type { AnalyseSource } from "../page"

// URL adapter around the shared SourceSelector: reads/writes searchParams so
// Analyse views stay shareable (a partner can send a link that opens on the
// exact same source + portfolio). Purely thin — the UI logic lives in
// SourceSelector.

const DEFAULT_SOURCE: AnalyseSource = "projet"

function isSource(v: string | null): v is AnalyseSource {
  return v === "projet" || v === "portefeuille"
}

interface SourcePickerProps {
  variant?: "header" | "inline"
}

export function SourcePicker({ variant = "header" }: SourcePickerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { portfolios } = usePortfolios()

  const portfolioAvailable = portfolios.length > 0
  const rawSource = searchParams.get("source")
  const source: AnalyseSource =
    isSource(rawSource) && portfolioAvailable ? rawSource : DEFAULT_SOURCE
  const rawPortfolioId = searchParams.get("portfolio")
  const portfolioId =
    rawPortfolioId && portfolios.some((p) => p.id === rawPortfolioId)
      ? rawPortfolioId
      : portfolios[0]?.id ?? null

  const pushUrl = useCallback(
    (patch: { source?: AnalyseSource; portfolio?: string | null }) => {
      const next = new URLSearchParams(searchParams)
      if (patch.source !== undefined) {
        if (patch.source === DEFAULT_SOURCE) next.delete("source")
        else next.set("source", patch.source)
      }
      if (patch.portfolio !== undefined) {
        if (patch.portfolio === null) next.delete("portfolio")
        else next.set("portfolio", patch.portfolio)
      }
      router.replace(next.size > 0 ? `/analyse?${next.toString()}` : "/analyse", {
        scroll: false,
      })
    },
    [router, searchParams],
  )

  return (
    <SourceSelector
      source={source as DataSource}
      onSourceChange={(s) =>
        pushUrl({ source: s, portfolio: s === "projet" ? null : portfolioId })
      }
      portfolios={portfolios}
      portfolioId={portfolioId}
      onPortfolioIdChange={(id) => pushUrl({ portfolio: id })}
      variant={variant}
      ariaLabel="Source des données"
    />
  )
}

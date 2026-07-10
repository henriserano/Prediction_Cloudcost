"use client"

import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { STARTER_PROMPTS } from "./constants"

export function EmptyChat({
  onPick,
  disabled,
}: {
  onPick: (prompt: string) => void
  disabled: boolean
}) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[color:var(--accent-green)]/20 to-[color:var(--brand)]/10 ring-1 ring-[color:var(--accent-green)]/30">
        <Sparkles className="h-6 w-6 text-[color:var(--accent-green)]" />
      </div>
      <div className="space-y-1.5">
        <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          Comment puis-je aider ?
        </h2>
        <p className="text-sm text-muted-foreground">
          Interroge la plateforme sur les coûts, les prévisions, les anomalies ou
          la qualité des données. Je consulte les endpoints d&apos;analyse en
          direct.
        </p>
      </div>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {STARTER_PROMPTS.map((s) => (
          <button
            key={s.label}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s.prompt)}
            className={cn(
              "group rounded-lg border border-border bg-background px-3.5 py-3 text-left text-xs transition-all",
              "hover:border-[color:var(--accent-green)]/40 hover:bg-[color:var(--accent-green)]/5",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-[color:var(--accent-green)]">
              {s.label}
            </span>
            <span className="text-foreground/80">{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

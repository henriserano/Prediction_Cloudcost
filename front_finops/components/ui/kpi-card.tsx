import * as React from "react"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface KpiCardProps {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  icon?: React.ElementType
  tone?: "default" | "green" | "destructive" | "success"
  delta?: { value: number; suffix?: string; direction?: "up" | "down" }
  info?: React.ReactNode
  className?: string
}

const TONE = {
  default: {
    icon: "bg-brand/8 text-brand [color:var(--brand)]",
    accent: "from-[color:var(--brand)] to-transparent",
  },
  green: {
    icon: "bg-[color:var(--accent-green)]/12 text-[color:var(--accent-green)]",
    accent: "from-[color:var(--accent-green)] to-transparent",
  },
  destructive: {
    icon: "bg-destructive/10 text-destructive",
    accent: "from-destructive to-transparent",
  },
  success: {
    icon: "bg-[color:var(--success)]/12 text-[color:var(--success)]",
    accent: "from-[color:var(--success)] to-transparent",
  },
} as const

export function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  delta,
  info,
  className,
}: KpiCardProps) {
  const t = TONE[tone]
  const deltaUp = delta && (delta.direction === "up" || (delta.direction == null && delta.value >= 0))

  return (
    <Card
      className={cn(
        "relative overflow-hidden group transition-all duration-200",
        "hover:shadow-md hover:-translate-y-px",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r",
          t.accent
        )}
      />
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <span>{label}</span>
              {info}
            </p>
            <p className="font-heading text-2xl font-semibold tabular-nums leading-tight text-foreground lg:text-[1.75rem]">
              {value}
            </p>
            {(sub || delta) && (
              <div className="flex items-center gap-2 pt-0.5">
                {delta && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      deltaUp
                        ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
                        : "bg-destructive/10 text-destructive"
                    )}
                  >
                    {deltaUp ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    {delta.value >= 0 ? "+" : ""}
                    {delta.value}
                    {delta.suffix ?? "%"}
                  </span>
                )}
                {sub && (
                  <p className="text-xs text-muted-foreground truncate">
                    {sub}
                  </p>
                )}
              </div>
            )}
          </div>
          {Icon && (
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
                t.icon
              )}
              aria-hidden
            >
              <Icon className="h-4 w-4" />
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

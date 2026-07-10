import * as React from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface SectionCardProps {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  info?: React.ReactNode
  children: React.ReactNode
  accent?: "brand" | "green" | "none"
  className?: string
  contentClassName?: string
}

export function SectionCard({
  title,
  description,
  action,
  info,
  children,
  accent = "brand",
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      {accent !== "none" && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-0 top-0 h-0.5",
            accent === "brand"
              ? "bg-gradient-to-r from-[color:var(--brand)] via-[color:var(--accent-green)]/70 to-transparent"
              : "bg-gradient-to-r from-[color:var(--accent-green)] via-[color:var(--accent-gold)]/70 to-transparent"
          )}
        />
      )}
      {(title || description || action || info) && (
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              {title && (
                <CardTitle className="text-sm flex items-center gap-2">
                  <span>{title}</span>
                  {info}
                </CardTitle>
              )}
              {description && (
                <CardDescription className="text-xs mt-0.5">
                  {description}
                </CardDescription>
              )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
          </div>
        </CardHeader>
      )}
      <CardContent className={cn(contentClassName)}>{children}</CardContent>
    </Card>
  )
}

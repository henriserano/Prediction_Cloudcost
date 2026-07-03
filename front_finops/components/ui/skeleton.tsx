import { cn } from "@/lib/utils"

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-lg bg-gradient-to-r from-muted via-muted/60 to-muted",
        className
      )}
      aria-hidden="true"
    />
  )
}

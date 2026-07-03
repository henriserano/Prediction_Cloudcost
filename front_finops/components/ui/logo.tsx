import { cn } from "@/lib/utils"

interface LogoProps {
  className?: string
  compact?: boolean
}

export function SiaLogo({ className, compact = false }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-[color:var(--accent-coral)] text-white shadow-sm"
      >
        <span className="font-heading text-[13px] font-bold leading-none tracking-tight">
          S
        </span>
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/30" />
      </span>
      {!compact && (
        <div className="leading-tight">
          <p className="font-heading text-sm font-semibold tracking-tight">
            Sia<span className="text-[color:var(--accent-coral)]">.</span>
          </p>
          <p className="text-[10px] text-white/50 font-medium uppercase tracking-widest">
            FinOps
          </p>
        </div>
      )}
    </div>
  )
}

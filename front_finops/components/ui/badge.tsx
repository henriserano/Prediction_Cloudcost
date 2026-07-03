import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-brand/20 bg-brand/8 text-brand-foreground/90 [color:var(--brand)]",
        coral:
          "border-[color:var(--accent-coral)]/20 bg-[color:var(--accent-coral)]/10 text-[color:var(--accent-coral)]",
        outline: "border-border bg-transparent text-muted-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        success:
          "border-transparent bg-[color:var(--success)]/12 text-[color:var(--success)]",
        warning:
          "border-transparent bg-[color:var(--warning)]/15 text-[color:var(--warning-foreground)]",
        destructive:
          "border-transparent bg-destructive/10 text-destructive",
        live:
          "border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]",
      },
      size: {
        default: "px-2 py-0.5 text-[11px]",
        sm: "px-1.5 py-0.5 text-[10px]",
        lg: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size, className }))}
      {...props}
    />
  )
}

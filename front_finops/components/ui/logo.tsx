import Image from "next/image"
import { cn } from "@/lib/utils"

interface LogoProps {
  className?: string
  compact?: boolean
  /**
   * When `true`, renders the logo on light surfaces (colours preserved).
   * When `false` (default), inverts the logo to pure white for dark surfaces
   * such as the sidebar (Sia Navy background).
   */
  onLight?: boolean
}

/**
 * Sia official logo — wordmark + Sia Teal slash.
 * Sourced from public/logosia.png (design-system asset).
 */
export function SiaLogo({ className, compact = false, onLight = false }: LogoProps) {
  const captionColor = onLight ? "text-muted-foreground" : "text-white/55"
  const captionBorder = onLight ? "border-border" : "border-white/15"

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Image
        src="/logosia.png"
        alt="Sia"
        width={72}
        height={28}
        priority
        className={cn(
          "h-7 w-auto select-none",
          !onLight && "brightness-0 invert",
        )}
      />
      {!compact && (
        <span
          className={cn(
            "border-l pl-2.5 text-[10px] font-semibold uppercase tracking-[0.18em]",
            captionColor,
            captionBorder,
          )}
        >
          FinOps
        </span>
      )}
    </div>
  )
}

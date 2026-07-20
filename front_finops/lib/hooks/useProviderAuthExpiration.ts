"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

// Query keys wiped when a given provider's server-side session is dropped.
// Everything derived from an authenticated /api/{provider}/* call must land
// here — otherwise the corresponding view stays on stale "connected" data
// while the backend already knows the session is gone.
const KEYS_BY_PROVIDER: Record<"gcp" | "aws", readonly string[]> = {
  gcp: [
    "gcp-status",
    "gcp-projects",
    "gcp-billing",
    "gcp-logs",
    "gcp-services",
  ],
  aws: [
    "aws-status",
    "aws-accounts",
    "aws-billing",
  ],
}

interface ProviderAuthExpiredDetail {
  provider: "gcp" | "aws"
}

/**
 * Listens for the ``provider-auth-expired`` window event dispatched by the
 * axios error interceptor (see ``lib/api.ts``) and invalidates every query
 * key derived from that provider's session. The status queries then refetch,
 * the backend reports ``authenticated=false``, and the UI naturally resets
 * to the ConnectCard / PIN prompt without any per-page bookkeeping.
 */
export function useProviderAuthExpirationListener(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    function onExpired(evt: Event) {
      const detail = (evt as CustomEvent<ProviderAuthExpiredDetail>).detail
      const keys = detail?.provider ? KEYS_BY_PROVIDER[detail.provider] : null
      if (!keys) return
      for (const key of keys) {
        void queryClient.invalidateQueries({ queryKey: [key] })
      }
    }
    window.addEventListener("provider-auth-expired", onExpired)
    return () => window.removeEventListener("provider-auth-expired", onExpired)
  }, [queryClient])
}

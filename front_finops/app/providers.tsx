"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { SidebarProvider } from "@/lib/context/sidebar-context"
import { AuthProvider } from "@/lib/context/auth-context"
import { AuthGate } from "@/components/auth/AuthGate"
import { useProviderAuthExpirationListener } from "@/lib/hooks/useProviderAuthExpiration"

function ProviderAuthWatchdog() {
  useProviderAuthExpirationListener()
  return null
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            retryDelay: 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  )
  return (
    <QueryClientProvider client={queryClient}>
      <ProviderAuthWatchdog />
      <AuthProvider>
        <SidebarProvider>
          <AuthGate>{children}</AuthGate>
        </SidebarProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

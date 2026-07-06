"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { SidebarProvider } from "@/lib/context/sidebar-context"
import { AuthProvider } from "@/lib/context/auth-context"
import { AuthGate } from "@/components/auth/AuthGate"

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
      <AuthProvider>
        <SidebarProvider>
          <AuthGate>{children}</AuthGate>
        </SidebarProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { WagmiProvider } from "wagmi"
import { wagmiConfig } from "@/domains/wallet/config"
import { ErrorToaster } from "@/shared/error-toaster"
import { createQueryClient } from "@/shared/query-client"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
        <ErrorToaster />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

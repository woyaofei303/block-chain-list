"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { WagmiProvider } from "wagmi"
import { wagmiConfig } from "@/domains/wallet/config"
import { ErrorToaster } from "@/shared/error-toaster"
import { createQueryClient } from "@/shared/query-client"

export function Providers({ children }: { children: React.ReactNode }) {
  // 整棵页面共用缓存与错误入口；重渲染时保留同一个 QueryClient，避免丢失请求状态。
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

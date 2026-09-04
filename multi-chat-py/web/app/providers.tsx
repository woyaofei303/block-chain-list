"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { isRetryableClientError } from "@/shared/http-client"
import { fullJitterDelay } from "@/shared/retry"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failureCount, error) =>
              failureCount < 2 && isRetryableClientError(error),
            retryDelay: (attempt) => fullJitterDelay(attempt),
            staleTime: 5_000,
          },
          // 默认不重试写请求；仅发送消息在调用处通过 requestKey 明确声明为可安全重试。
          mutations: { retry: false },
        },
      })
  )
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

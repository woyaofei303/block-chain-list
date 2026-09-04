"use client"

/** 全局浏览器服务端状态容器；统一只读请求的重试策略，写请求默认不重试。 */
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

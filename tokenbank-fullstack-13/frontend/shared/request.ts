import PQueue from "p-queue"
import { AppError } from "./errors.ts"

// 一个标签页内所有调用共享名额；只在真正发送后开始超时计时。
const queue = new PQueue({ concurrency: 6 })
export async function request<T>(
  url: string,
  options: {
    parse: (data: unknown) => T
    method?: "GET" | "POST"
    body?: unknown
    headers?: HeadersInit
    signal?: AbortSignal
    timeoutMs?: number
  }
): Promise<T> {
  options.signal?.throwIfAborted()
  return queue.add(
    async () => {
      options.signal?.throwIfAborted()
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? 10_000)
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeout.signal])
        : timeout.signal
      try {
        const response = await fetch(url, {
          method: options.method ?? "GET",
          credentials: "same-origin",
          headers: {
            ...(options.body === undefined ? {} : { "content-type": "application/json" }),
            ...Object.fromEntries(new Headers(options.headers)),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal,
        })
        const data: unknown = await response.json().catch(() => null)
        signal.throwIfAborted()
        if (!response.ok) {
          const record = data && typeof data === "object" ? data : {}
          const code =
            "code" in record && typeof record.code === "string"
              ? record.code
              : `HTTP_${response.status}`
          const message =
            "error" in record && typeof record.error === "string"
              ? record.error
              : `请求失败（HTTP ${response.status}）`
          throw new AppError("http", code, message, {
            severity: options.method === "POST" || response.status === 401 ? 1 : 0,
            retryable: response.status >= 500 || response.status === 429,
            requestId: response.headers.get("x-request-id") ?? undefined,
          })
        }
        return options.parse(data)
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason
        if (timeout.signal.aborted)
          throw new AppError("timeout", "TIMEOUT", "请求超时，请稍后重试", {
            retryable: true,
            severity: options.method === "POST" ? 1 : 0,
          })
        if (error instanceof TypeError)
          throw new AppError("network", "NETWORK", "网络连接失败，请检查连接", {
            retryable: true,
            severity: options.method === "POST" ? 1 : 0,
          })
        throw error
      } finally {
        clearTimeout(timer)
      }
    },
    { signal: options.signal }
  )
}

export function wait(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel)
      resolve()
    }, ms)
    signal?.addEventListener("abort", cancel, { once: true })
  })
}

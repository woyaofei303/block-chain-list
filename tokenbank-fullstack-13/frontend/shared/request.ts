import PQueue from "p-queue"
import { AppError } from "./errors.ts"

// 一个标签页内所有调用共享名额；只在真正发送后开始超时计时。
const queue = new PQueue({ concurrency: 6 })
/** HTTP 统一入口：领域层通过 parse 校验响应；重试与 Toast 交给 QueryClient，不在这里重复处理。 */
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
        // 读取完响应体才释放并发名额；只等响应头会漏算仍在下载的请求。
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
    // 同一个信号同时取消等待任务和在途 fetch，不清空其他批次共用的队列。
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

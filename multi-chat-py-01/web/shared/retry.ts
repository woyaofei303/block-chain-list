/** 浏览器请求和上游模型请求共享的最小退避策略。 */

// 上游模型请求和浏览器 API 请求共享同一组临时故障状态。
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

/** Full Jitter：在 [0, min(8s, 500ms * 2^attempt)] 内随机，减少并发重试碰撞。 */
export function fullJitterDelay(
  attempt: number,
  random: () => number = Math.random
) {
  return Math.round(random() * Math.min(8_000, 500 * 2 ** attempt))
}

export function isRetryableStatus(status: number) {
  return RETRYABLE_STATUSES.has(status)
}

export function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    // 等待必须响应取消，否则用户停止生成后仍会卡在退避计时器里。
    const onAbort = () => {
      clearTimeout(timeout)
      reject(signal?.reason)
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

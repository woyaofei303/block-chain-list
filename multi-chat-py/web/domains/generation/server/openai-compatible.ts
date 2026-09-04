import {
  fullJitterDelay,
  isRetryableStatus,
  wait,
} from "../../../shared/retry.ts"

export type ModelMessage = {
  role: "user" | "assistant"
  content: string
}

export type AiConfig = {
  apiKey: string
  baseUrl: string
  model: string
}

/** 优先读取通用 AI_* 配置，同时兼容旧 Python 版使用的 DEEPSEEK_* 变量。 */
export function getAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const apiKey = env.AI_API_KEY ?? env.DEEPSEEK_API_KEY
  const usingDeepSeek = Boolean(env.DEEPSEEK_API_KEY && !env.AI_API_KEY)
  if (!apiKey) {
    throw new Error("缺少 AI_API_KEY（也兼容 DEEPSEEK_API_KEY）")
  }
  return {
    apiKey,
    baseUrl: (
      env.AI_BASE_URL ??
      env.DEEPSEEK_BASE_URL ??
      (usingDeepSeek ? "https://api.deepseek.com" : "https://api.openai.com/v1")
    ).replace(/\/$/, ""),
    model: getConfiguredModel(env),
  }
}

export function getConfiguredModel(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.AI_MODEL ??
    env.DEEPSEEK_MODEL ??
    (env.DEEPSEEK_API_KEY && !env.AI_API_KEY ? "deepseek-chat" : "gpt-4.1-mini")
  )
}

export async function* streamChatCompletion(
  messages: ModelMessage[],
  config: AiConfig,
  signal: AbortSignal
) {
  for (let attempt = 0; ; attempt += 1) {
    // 一旦向客户端发过 token 就不自动重试：重新请求模型可能生成不同答案，
    // 将两次结果拼起来会造成内容损坏。此时交给用户显式重试整条回答。
    let emitted = false
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: config.model, messages, stream: true }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
      })
      if (!response.ok) {
        throw new AiRequestError(response.status, retryAfter(response.headers))
      }
      if (!response.body) throw new Error("模型响应没有可读取的数据流")

      for await (const content of parseOpenAiStream(response.body)) {
        emitted = true
        yield content
      }
      return
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (emitted || attempt >= 3 || !isRetryableError(error)) throw error
      const retryAfterMs =
        error instanceof AiRequestError ? error.retryAfterMs : 0
      // 服务端 Retry-After 与本地指数退避取较大值，避免过早再次打到限流接口。
      await wait(Math.max(retryAfterMs, fullJitterDelay(attempt)), signal)
    }
  }
}

export async function* parseOpenAiStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    // 网络分块不保证和 SSE 事件边界一致，必须缓存到空行后才能解析完整事件。
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() ?? ""
    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
      if (!data || data === "[DONE]") continue
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: unknown } }>
      }
      const content = parsed.choices?.[0]?.delta?.content
      if (typeof content === "string" && content) yield content
    }
    if (done) break
  }
}

class AiRequestError extends Error {
  status: number
  retryAfterMs: number

  constructor(status: number, retryAfterMs: number) {
    super(`模型请求失败（${status}）`)
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

function isRetryableError(error: unknown) {
  return (
    (error instanceof AiRequestError && isRetryableStatus(error.status)) ||
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === "TimeoutError")
  )
}

function retryAfter(headers: Headers) {
  const value = headers.get("retry-after")
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000)
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : Math.max(0, timestamp - Date.now())
}

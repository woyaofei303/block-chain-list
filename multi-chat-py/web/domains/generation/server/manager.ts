import type { GenerationEvent, GenerationUpdate } from "../model.ts"

/**
 * 单次生成的内存事件缓冲区。事件 ID 严格递增，断线客户端可用 last-id 只补拉遗漏事件。
 * 终态事件只能发布一次，发布后不再接受新 token。
 */
export function createGenerationBuffer(id: string) {
  const events: GenerationEvent[] = []
  const listeners = new Set<(event: GenerationEvent) => void>()
  let terminal = false

  return {
    id,
    get terminal() {
      return terminal
    },
    get nextEventId() {
      return events.length + 1
    },
    publish(type: GenerationEvent["type"], data: GenerationEvent["data"]) {
      if (terminal) return null
      const event = { id: events.length + 1, type, data }
      events.push(event)
      if (type !== "delta") terminal = true
      listeners.forEach((listener) => {
        listener(event)
      })
      if (terminal) listeners.clear()
      return event
    },
    eventsAfter(lastEventId: number) {
      return events.filter(({ id: eventId }) => eventId > lastEventId)
    },
    subscribe(listener: (event: GenerationEvent) => void) {
      if (!terminal) listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

type GenerationManagerOptions = {
  stream: (
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    signal: AbortSignal
  ) => AsyncIterable<string>
  persist: (generationId: string, update: GenerationUpdate) => Promise<unknown>
}

export function createGenerationManager(options: GenerationManagerOptions) {
  const jobs = new Map<
    string,
    {
      buffer: ReturnType<typeof createGenerationBuffer>
      controller: AbortController
      completion: Promise<void>
    }
  >()

  function start(input: {
    id: string
    messages: Array<{ role: "user" | "assistant"; content: string }>
  }) {
    // 相同 generationId 重复启动时复用原任务，配合请求幂等避免并行调用模型。
    const existing = jobs.get(input.id)
    if (existing) return existing.buffer

    const buffer = createGenerationBuffer(input.id)
    const controller = new AbortController()
    const job = {
      buffer,
      controller,
      completion: Promise.resolve(),
    }
    jobs.set(input.id, job)
    job.completion = run(input, buffer, controller.signal)
      .catch((error) => console.error("Failed to persist generation", error))
      .finally(() => {
        // 完成后短暂保留回放缓冲，给刚断线的客户端留出重连窗口。
        const timer = setTimeout(() => jobs.delete(input.id), 10 * 60_000)
        timer.unref?.()
      })
    return buffer
  }

  async function run(
    input: {
      id: string
      messages: Array<{ role: "user" | "assistant"; content: string }>
    },
    buffer: ReturnType<typeof createGenerationBuffer>,
    signal: AbortSignal
  ) {
    let content = ""
    let lastEventId = 0
    let persistTimer: ReturnType<typeof setTimeout> | undefined
    let pendingPersist = Promise.resolve<unknown>(undefined)

    const persist = (status: GenerationUpdate["status"]) => {
      const update = { content, status, lastEventId }
      // 持久化也保持顺序；某次写失败不会让后续最终状态永远排不上队。
      pendingPersist = pendingPersist
        .catch(() => undefined)
        .then(() => options.persist(input.id, update))
      return pendingPersist
    }
    const schedulePersist = () => {
      // 合并高频 token 写入，最多约每 250ms 落盘一次，而不是每个字符写一次文件。
      persistTimer ??= setTimeout(() => {
        persistTimer = undefined
        void persist("streaming")
      }, 250)
    }

    try {
      for await (const text of options.stream(input.messages, signal)) {
        content += text
        const event = buffer.publish("delta", { text })
        if (!event) throw new Error("生成事件缓冲区已结束")
        lastEventId = event.id
        schedulePersist()
      }
      lastEventId = buffer.nextEventId
      if (persistTimer) clearTimeout(persistTimer)
      // 先持久化终态再通知客户端，终态后的详情刷新才能立即读到完整答案。
      await persist("completed")
      buffer.publish("done", {})
    } catch {
      const stopped = signal.aborted
      lastEventId = buffer.nextEventId
      if (persistTimer) clearTimeout(persistTimer)
      try {
        // 中断时保留已收到的部分文本，用户仍可查看，并可在原消息位置重试。
        await persist(stopped ? "stopped" : "failed")
      } finally {
        buffer.publish(stopped ? "stopped" : "error", {
          message: stopped ? "已停止生成" : "生成中断，请重试",
        })
      }
    }
  }

  return {
    start,
    get(id: string) {
      return jobs.get(id)?.buffer
    },
    stop(id: string) {
      const job = jobs.get(id)
      if (!job || job.buffer.terminal) return false
      job.controller.abort(new DOMException("Stopped", "AbortError"))
      return true
    },
    async finished(id: string) {
      await jobs.get(id)?.completion
    },
  }
}

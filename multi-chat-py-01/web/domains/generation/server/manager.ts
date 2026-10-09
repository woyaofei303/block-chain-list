/**
 * 模型生成任务的生命周期管理器。
 *
 * 输入是完整模型上下文，输出同时走两条路：事件缓冲供 SSE 实时消费，聚合后的
 * GenerationUpdate 交给 ConversationStore 持久化。这里不依赖具体模型服务。
 */
import type {
  GenerationEvent,
  GenerationUpdate,
  ModelMessage,
} from "../model.ts"

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
    /** 告诉订阅端是否已有终态；结束后回放完历史就能关闭连接。 */
    get terminal() {
      return terminal
    },
    /** 给即将保存的终态预留连续编号，保证磁盘进度与随后发布的事件一致。 */
    get nextEventId() {
      return events.length + 1
    },
    /** 按 1、2、3 分配事件编号并通知订阅者；done、error 或 stopped 后拒绝再追加文本。 */
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
    /** 只回放游标之后的事件，例如已收到 3 就从 4 开始，客户端仍须按编号去重。 */
    eventsAfter(lastEventId: number) {
      return events.filter(({ id: eventId }) => eventId > lastEventId)
    },
    /** 登记当前连接的监听器并返回取消订阅函数；终态后不再新增监听。 */
    subscribe(listener: (event: GenerationEvent) => void) {
      if (!terminal) listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

type GenerationManagerOptions = {
  stream: (
    messages: ModelMessage[],
    signal: AbortSignal
  ) => AsyncIterable<string>
  persist: (generationId: string, update: GenerationUpdate) => Promise<unknown>
}

/** 把模型流、事件缓冲和历史写入组合为任务；数据保存通过传入的 persist 完成，不直接操作文件。 */
export function createGenerationManager(options: GenerationManagerOptions) {
  const jobs = new Map<
    string,
    {
      buffer: ReturnType<typeof createGenerationBuffer>
      controller: AbortController
      completion: Promise<void>
    }
  >()

  /** 同一生成编号只启动一次模型流，完成后保留十分钟事件供短暂断线恢复。 */
  function start(input: { id: string; messages: ModelMessage[] }) {
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

  /** 把逐段文本累积成完整回答，节流保存；完成、失败或取消都先保存终态，再通知订阅者。 */
  async function run(
    input: {
      id: string
      messages: ModelMessage[]
    },
    buffer: ReturnType<typeof createGenerationBuffer>,
    signal: AbortSignal
  ) {
    let content = ""
    let lastEventId = 0
    let persistTimer: ReturnType<typeof setTimeout> | undefined
    let pendingPersist = Promise.resolve<unknown>(undefined)

    /** 截取此刻内容和事件编号，按顺序写入；前一次保存失败不会堵死最后的收尾保存。 */
    const persist = (status: GenerationUpdate["status"]) => {
      const update = { content, status, lastEventId }
      // 持久化也保持顺序；某次写失败不会让后续最终状态永远排不上队。
      pendingPersist = pendingPersist
        .catch(() => undefined)
        .then(() => options.persist(input.id, update))
      return pendingPersist
    }
    /** 合并 250 毫秒内到达的文本，减少小文件反复写盘，最终状态仍立即保存。 */
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
    /** 只读取内存中的任务缓冲；进程重启后不能用它续接原模型连接。 */
    get(id: string) {
      return jobs.get(id)?.buffer
    },
    /** 向仍在运行的任务发取消信号，保留已生成文本；任务不存在或已结束时返回 false。 */
    stop(id: string) {
      const job = jobs.get(id)
      if (!job || job.buffer.terminal) return false
      job.controller.abort(new DOMException("Stopped", "AbortError"))
      return true
    },
    /** 等待取消或完成后的保存收尾，删除会话前用它避免删完又被任务写回。 */
    async finished(id: string) {
      await jobs.get(id)?.completion
    },
  }
}

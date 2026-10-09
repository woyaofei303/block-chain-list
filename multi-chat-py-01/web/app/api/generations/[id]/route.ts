/**
 * GET/DELETE /api/generations/:id：本机生成任务的 SSE 订阅与取消入口。
 *
 * 这里转发的是 GenerationManager 的内部事件，不直接连接模型供应商。
 */
import type { GenerationEvent } from "@/domains/generation/model"
import { runtime as appRuntime } from "@/server/runtime"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

/** 订阅本机生成事件并补发断线期间遗漏的部分；关闭浏览器连接只退订，不会自动停止模型。 */
export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  const generation = appRuntime.generations.get(id)
  if (!generation) {
    return Response.json({ error: "生成任务不存在或已结束" }, { status: 404 })
  }

  const url = new URL(request.url)
  // 浏览器自动重连会发送 Last-Event-ID；手动新建 EventSource 时用 after 补传。
  // 两者取较大值，确保只回放客户端尚未处理的事件。
  const lastEventId = Math.max(
    parseEventId(request.headers.get("last-event-id")),
    parseEventId(url.searchParams.get("after"))
  )
  const encoder = new TextEncoder()
  /** 订阅建立前先放一个空清理函数，保证连接提前关闭时也能安全执行清理。 */
  let unsubscribe = () => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    /** 建立订阅后回放历史，并发送心跳维持连接；历史与实时重叠的事件由客户端去重。 */
    start(controller) {
      /** 只关闭一次流，并释放监听器和心跳，防止终态与连接结束重复清理。 */
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe()
        if (heartbeat) clearInterval(heartbeat)
        controller.close()
      }
      /** 编码并写出一条事件；文本增量继续接收，终态送达后关闭该连接。 */
      const send = (event: GenerationEvent) => {
        if (closed) return
        controller.enqueue(encoder.encode(serializeEvent(event)))
        if (event.type !== "delta") close()
      }

      // 先订阅再回放，避免“读取历史”和“开始监听”之间刚好漏掉一个新事件。
      // 客户端按 event id 去重，因此极小窗口内的重复投递是安全的。
      unsubscribe = generation.subscribe(send)
      generation.eventsAfter(lastEventId).forEach(send)
      if (generation.terminal) return close()
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"))
      }, 15_000)
    },
    /** 浏览器断开时释放订阅和心跳，任务本身继续，重新打开页面仍可读取进度。 */
    cancel() {
      closed = true
      unsubscribe()
      if (heartbeat) clearInterval(heartbeat)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 禁止反向代理缓冲，否则 token 会攒成一批后才到达浏览器。
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

/** 仅发出停止信号并返回 202，实际收尾和部分文本保存由生成管理器完成。 */
export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params
  // 此处只发取消信号；生成管理器负责保留部分内容并持久化 stopped 状态。
  if (!appRuntime.generations.stop(id)) {
    return Response.json({ error: "生成任务不存在或已经结束" }, { status: 404 })
  }
  return new Response(null, { status: 202 })
}

/** 把重连游标限定为非负安全整数，无效值从头回放，客户端负责去重。 */
function parseEventId(value: string | null) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

/** 按 SSE 的 id、event、data 格式编码，末尾空行表示这一条事件结束。 */
function serializeEvent(event: GenerationEvent) {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
}

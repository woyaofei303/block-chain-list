import type { GenerationEvent } from "@/domains/generation/model"
import { runtime as appRuntime } from "@/server/runtime"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

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
  let unsubscribe = () => {}
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe()
        if (heartbeat) clearInterval(heartbeat)
        controller.close()
      }
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

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params
  // 此处只发取消信号；生成管理器负责保留部分内容并持久化 stopped 状态。
  if (!appRuntime.generations.stop(id)) {
    return Response.json({ error: "生成任务不存在或已经结束" }, { status: 404 })
  }
  return new Response(null, { status: 202 })
}

function parseEventId(value: string | null) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
}

function serializeEvent(event: GenerationEvent) {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
}

/** Generation 领域在模型适配器、任务管理器和浏览器 SSE 客户端之间共享的数据。 */
export type ModelMessage = {
  role: "user" | "assistant"
  content: string
}

export type GenerationEvent = {
  id: number
  type: "delta" | "done" | "error" | "stopped"
  data: Record<string, unknown>
}

export type GenerationUpdate = {
  content: string
  status: "streaming" | "completed" | "stopped" | "failed"
  lastEventId: number
}

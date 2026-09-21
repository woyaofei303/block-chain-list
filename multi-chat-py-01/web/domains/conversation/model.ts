/** Conversation 领域的持久化模型，也是 API 与浏览器 Query 缓存的数据形状。 */
export type MessageStatus = "streaming" | "completed" | "stopped" | "failed"

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  status: MessageStatus
  createdAt: string
  model?: string
  generationId?: string
  requestKey?: string
  lastEventId?: number
}

export type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}

export type ConversationSummary = Pick<Conversation, "id" | "title">

export function titleFromPrompt(prompt: string) {
  const title = prompt.replace(/\s+/g, " ").trim()
  return title.length > 36 ? `${title.slice(0, 36)}…` : title || "新对话"
}

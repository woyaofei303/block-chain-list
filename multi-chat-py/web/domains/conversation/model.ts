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

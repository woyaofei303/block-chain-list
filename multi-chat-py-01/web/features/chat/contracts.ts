/**
 * “发送或重试一条消息”用例的跨层契约。
 *
 * 浏览器 Mutation、HTTP Route 和服务端 ChatService 都依赖这里，避免三层各自
 * 声明一份稍有差异的请求结构。HTTP Route 仍负责校验外部输入，类型不能替代校验。
 */
export type SendMessageCommand =
  | { content: string; requestKey: string }
  | { retryAssistantMessageId: string; requestKey: string }

export type SendMessageRequest = SendMessageCommand & {
  conversationId: string
}

export type SendMessageResult = {
  reused: boolean
  generationId: string
  assistantMessageId: string
}

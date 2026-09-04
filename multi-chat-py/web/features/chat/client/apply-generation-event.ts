/** 将一个已校验来源的生成事件归并到助手消息；这是 SSE 到 UI 模型的纯函数边界。 */
import type { ChatMessage } from "../../../domains/conversation/model.ts"
import type { GenerationEvent } from "../../../domains/generation/model.ts"

export function applyGenerationEvent(
  message: ChatMessage,
  event: GenerationEvent
): ChatMessage {
  // 重连回放可能和断线前已收到的事件重叠；以单调 event id 去重后再拼接文本。
  if (event.id <= (message.lastEventId ?? 0)) return message
  const text = event.type === "delta" ? event.data.text : null
  const status =
    event.type === "done"
      ? "completed"
      : event.type === "stopped"
        ? "stopped"
        : event.type === "error"
          ? "failed"
          : "streaming"
  return {
    ...message,
    content:
      typeof text === "string" ? `${message.content}${text}` : message.content,
    status,
    lastEventId: event.id,
  }
}

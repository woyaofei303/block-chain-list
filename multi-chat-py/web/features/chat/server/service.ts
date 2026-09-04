/**
 * Chat 用例的服务端编排层。
 *
 * 它是 Conversation（历史/占位消息）与 Generation（模型任务/事件）两个领域唯一的
 * 连接点：先获得可持久化的 generationId，再且仅再启动一次模型请求。
 */
import type { createConversationStore } from "../../../domains/conversation/server/store.ts"
import type { createGenerationManager } from "../../../domains/generation/server/manager.ts"
import type { SendMessageCommand, SendMessageResult } from "../contracts.ts"

type ChatServiceOptions = {
  store: Pick<
    ReturnType<typeof createConversationStore>,
    | "activeGenerationIds"
    | "addUserTurn"
    | "deleteConversation"
    | "getGenerationContext"
    | "retryAssistant"
  >
  generations: Pick<
    ReturnType<typeof createGenerationManager>,
    "finished" | "start" | "stop"
  >
  getModel: () => string
}

/** 编排会话和生成两个领域；领域内部不直接相互引用。 */
export function createChatService(options: ChatServiceOptions) {
  return {
    async sendMessage(
      conversationId: string,
      input: SendMessageCommand
    ): Promise<SendMessageResult> {
      const model = options.getModel()
      const result =
        "retryAssistantMessageId" in input
          ? await options.store.retryAssistant(conversationId, {
              assistantMessageId: input.retryAssistantMessageId,
              requestKey: input.requestKey,
              model,
            })
          : await options.store.addUserTurn(conversationId, {
              content: input.content,
              requestKey: input.requestKey,
              model,
            })

      // 传输层重试会返回同一 generationId，不能再次调用上游模型。
      if (!result.reused) {
        options.generations.start({
          id: result.generationId,
          messages: await options.store.getGenerationContext(
            result.generationId
          ),
        })
      }
      return result
    },

    async deleteConversation(conversationId: string) {
      const activeIds = await options.store.activeGenerationIds(conversationId)
      for (const generationId of activeIds) {
        options.generations.stop(generationId)
        await options.generations.finished(generationId)
      }
      return options.store.deleteConversation(conversationId)
    },
  }
}

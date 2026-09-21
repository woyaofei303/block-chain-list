import "server-only"

/**
 * 服务端组合根：在唯一地点创建 Store、模型适配器、GenerationManager 和 ChatService。
 * Route 只使用组装后的 runtime，不自行 new 领域对象或读取 API Key。
 */
import path from "node:path"

import { createConversationStore } from "../domains/conversation/server/store.ts"
import { createGenerationManager } from "../domains/generation/server/manager.ts"
import {
  getAiConfig,
  getConfiguredModel,
  streamChatCompletion,
} from "../domains/generation/server/openai-compatible.ts"
import { createChatService } from "../features/chat/server/service.ts"

function createRuntime() {
  const store = createConversationStore({
    storePath:
      process.env.CHAT_STORE_PATH ??
      path.join(process.cwd(), "data/chat-store.json"),
    legacyPath:
      process.env.LEGACY_HISTORY_PATH ??
      path.join(process.cwd(), "..", "chat_history.json"),
  })
  const generations = createGenerationManager({
    stream(messages, signal) {
      return streamChatCompletion(messages, getAiConfig(), signal)
    },
    persist(generationId, update) {
      return store.updateAssistant(generationId, update)
    },
  })
  const chat = createChatService({
    store,
    generations,
    getModel: getConfiguredModel,
  })
  return { store, generations, chat }
}

type Runtime = ReturnType<typeof createRuntime>
const globalRuntime = globalThis as typeof globalThis & {
  multiChatRuntime?: Runtime
}

// 挂在 globalThis 上可避免 Next.js 开发模式热更新时重复创建存储和生成任务注册表。
export const runtime = globalRuntime.multiChatRuntime ?? createRuntime()
globalRuntime.multiChatRuntime = runtime

export function configuredModel() {
  return getConfiguredModel()
}

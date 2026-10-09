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

/** 在服务端创建共享仓库、任务管理器和用例服务，路由复用这一组对象来关联生成与历史。 */
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
    /** 模型适配器按需读取服务端配置，返回可取消的文本流，密钥不会进入客户端。 */
    stream(messages, signal) {
      return streamChatCompletion(messages, getAiConfig(), signal)
    },
    /** 把生成快照写回对应助手消息，消息内容与 SSE 已处理进度一起保存。 */
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

/** 供会话列表展示当前模型名，不返回密钥或模型服务配置。 */
export function configuredModel() {
  return getConfiguredModel()
}

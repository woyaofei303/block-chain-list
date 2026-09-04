import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  type ChatMessage,
  type Conversation,
  titleFromPrompt,
} from "../model.ts"

type ChatStoreData = {
  version: 1
  legacyImportedAt: string
  conversations: Conversation[]
}

type StoreOptions = {
  storePath: string
  legacyPath: string
  now?: () => string
  createId?: () => string
}

/**
 * 单机版会话仓库。
 *
 * 数据保存在一个 JSON 文件中，并在进程内串行化所有写操作。这里没有为多进程并发
 * 做文件锁；如果以后需要多实例部署，应把这一层替换成带事务的数据库。
 */
export function createConversationStore(options: StoreOptions) {
  const now = options.now ?? (() => new Date().toISOString())
  const createId = options.createId ?? randomUUID
  let dataPromise: Promise<ChatStoreData> | undefined
  let writes = Promise.resolve()

  async function writeStore(data: ChatStoreData) {
    await mkdir(path.dirname(options.storePath), { recursive: true })
    const temporaryPath = `${options.storePath}.tmp`
    // 先完整写入临时文件再原子替换，避免进程中断后留下半截 JSON。
    await writeFile(temporaryPath, JSON.stringify(data, null, 2), "utf8")
    await rename(temporaryPath, options.storePath)
  }

  async function load(): Promise<ChatStoreData> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(options.storePath, "utf8")
      )
      if (!isChatStoreData(parsed)) {
        throw new Error(`Web 历史格式无效：${options.storePath}`)
      }
      const data = parsed
      // 进程退出后上一次的流已不可能继续，将悬挂状态转成可重试的失败状态。
      const interrupted = data.conversations.some((conversation) =>
        conversation.messages.some((message) => {
          if (message.status !== "streaming") return false
          message.status = "failed"
          return true
        })
      )
      if (interrupted) await writeStore(data)
      return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }

    // 仅在 Web 存储尚不存在时导入 Python 版历史；创建新存储后不会重复导入。
    const importedAt = now()
    let conversations: Conversation[] = []
    try {
      const legacy: unknown = JSON.parse(
        await readFile(options.legacyPath, "utf8")
      )
      if (!isLegacyHistory(legacy)) {
        throw new Error(`旧历史格式无效：${options.legacyPath}`)
      }
      if (legacy.length > 0) {
        const firstUserMessage = legacy.find(({ role }) => role === "user")
        conversations = [
          {
            id: createId(),
            title: titleFromPrompt(firstUserMessage?.content ?? "原有对话"),
            createdAt: importedAt,
            updatedAt: importedAt,
            messages: legacy.map((message) => ({
              id: createId(),
              role: message.role,
              content: message.content,
              status: "completed",
              createdAt: importedAt,
            })),
          },
        ]
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }

    const data: ChatStoreData = {
      version: 1,
      legacyImportedAt: importedAt,
      conversations,
    }
    await writeStore(data)
    return data
  }

  function initialize() {
    // 同一进程只读盘一次，后续读写都共享这一份内存快照。
    dataPromise ??= load()
    return dataPromise
  }

  function mutate<T>(change: (data: ChatStoreData) => T | Promise<T>) {
    // Promise 链相当于单机写锁，防止两个请求互相覆盖；失败后仍继续接收下一次写入。
    const operation = writes.then(async () => {
      const data = await initialize()
      const result = await change(data)
      await writeStore(data)
      // 不把仓库内部对象直接交给调用者，避免外部无意中绕过持久化修改数据。
      return structuredClone(result)
    })
    writes = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  return {
    async listConversations() {
      await writes
      const data = await initialize()
      return structuredClone(
        data.conversations.toSorted((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        )
      )
    },
    async getConversation(id: string) {
      await writes
      const data = await initialize()
      return structuredClone(
        data.conversations.find((conversation) => conversation.id === id) ??
          null
      )
    },
    createConversation() {
      return mutate((data) => {
        const timestamp = now()
        const conversation: Conversation = {
          id: createId(),
          title: "新对话",
          createdAt: timestamp,
          updatedAt: timestamp,
          messages: [],
        }
        data.conversations.push(conversation)
        return conversation
      })
    },
    renameConversation(id: string, title: string) {
      return mutate((data) => {
        const conversation = requireConversation(data, id)
        const normalized = title.replace(/\s+/g, " ").trim()
        if (!normalized || normalized.length > 80) {
          throw new Error("标题长度必须为 1 到 80 个字符")
        }
        conversation.title = normalized
        conversation.updatedAt = now()
        return conversation
      })
    },
    deleteConversation(id: string) {
      return mutate((data) => {
        const index = data.conversations.findIndex((item) => item.id === id)
        if (index === -1) throw new Error("会话不存在")
        const [removed] = data.conversations.splice(index, 1)
        return removed
      })
    },
    addUserTurn(
      conversationId: string,
      input: { content: string; requestKey: string; model: string }
    ) {
      return mutate((data) => {
        const conversation = requireConversation(data, conversationId)
        // 幂等检查必须早于“是否正在生成”：同一 HTTP 请求重试时应返回原任务，
        // 而不是因为它自己创建的 streaming 消息而报冲突。
        const existing = conversation.messages.find(
          (message) =>
            message.role === "assistant" &&
            message.requestKey === input.requestKey
        )
        if (existing) {
          if (!existing.generationId) throw new Error("生成任务缺少 ID")
          return {
            reused: true,
            generationId: existing.generationId,
            assistantMessageId: existing.id,
          }
        }
        if (
          conversation.messages.some(
            (message) => message.status === "streaming"
          )
        ) {
          throw new Error("当前会话仍有回答正在生成")
        }

        const content = input.content.trim()
        if (!content) throw new Error("消息不能为空")
        const timestamp = now()
        const generationId = createId()
        const userMessage: ChatMessage = {
          id: createId(),
          role: "user",
          content,
          status: "completed",
          createdAt: timestamp,
          requestKey: input.requestKey,
        }
        const assistantMessage: ChatMessage = {
          id: createId(),
          role: "assistant",
          content: "",
          status: "streaming",
          createdAt: timestamp,
          model: input.model,
          generationId,
          requestKey: input.requestKey,
          lastEventId: 0,
        }
        if (!conversation.messages.some((message) => message.role === "user")) {
          // 只用第一条用户消息自动命名，后续消息不会覆盖用户手动修改的标题。
          conversation.title = titleFromPrompt(content)
        }
        conversation.messages.push(userMessage, assistantMessage)
        conversation.updatedAt = timestamp
        return {
          reused: false,
          generationId,
          assistantMessageId: assistantMessage.id,
        }
      })
    },
    updateAssistant(
      generationId: string,
      update: Partial<Pick<ChatMessage, "content" | "status" | "lastEventId">>
    ) {
      return mutate((data) => {
        const conversation = data.conversations.find((item) =>
          item.messages.some((message) => message.generationId === generationId)
        )
        const message = conversation?.messages.find(
          (item) => item.generationId === generationId
        )
        if (!conversation || !message || message.role !== "assistant") {
          throw new Error("生成任务不存在")
        }
        Object.assign(message, update)
        conversation.updatedAt = now()
        return message
      })
    },
    retryAssistant(
      conversationId: string,
      input: { assistantMessageId: string; requestKey: string; model: string }
    ) {
      return mutate((data) => {
        const conversation = requireConversation(data, conversationId)
        const message = conversation.messages.find(
          (item) => item.id === input.assistantMessageId
        )
        if (message?.role !== "assistant") {
          throw new Error("助手消息不存在")
        }
        if (message.requestKey === input.requestKey) {
          if (!message.generationId) throw new Error("生成任务缺少 ID")
          return {
            generationId: message.generationId,
            assistantMessageId: message.id,
            reused: true,
          }
        }
        if (message.status === "streaming") {
          throw new Error("回答仍在生成中")
        }
        const generationId = createId()
        // 重试复用原助手消息位置，清空残缺内容，避免历史中出现两条同义回答。
        Object.assign(message, {
          content: "",
          status: "streaming" as const,
          model: input.model,
          generationId,
          requestKey: input.requestKey,
          lastEventId: 0,
        })
        conversation.updatedAt = now()
        return { generationId, assistantMessageId: message.id, reused: false }
      })
    },
    async getGenerationContext(generationId: string) {
      await writes
      const data = await initialize()
      for (const conversation of data.conversations) {
        const index = conversation.messages.findIndex(
          (message) => message.generationId === generationId
        )
        if (index === -1) continue
        // 当前助手占位消息不发送给模型；失败或停止的助手内容也不进入下一轮上下文。
        return conversation.messages
          .slice(0, index)
          .filter(
            (message) =>
              message.role === "user" || message.status === "completed"
          )
          .map(({ role, content }) => ({ role, content }))
      }
      throw new Error("生成任务不存在")
    },
    async activeGenerationIds(id: string) {
      await writes
      const data = await initialize()
      const conversation = data.conversations.find((item) => item.id === id)
      if (!conversation) throw new Error("会话不存在")
      return conversation.messages.flatMap((message) =>
        message.status === "streaming" && message.generationId
          ? [message.generationId]
          : []
      )
    },
  }
}

function requireConversation(data: ChatStoreData, id: string) {
  const conversation = data.conversations.find((item) => item.id === id)
  if (!conversation) throw new Error("会话不存在")
  return conversation
}

function isLegacyHistory(
  value: unknown
): value is Array<{ role: "user" | "assistant"; content: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (message) =>
        message !== null &&
        typeof message === "object" &&
        ((message as { role?: unknown }).role === "user" ||
          (message as { role?: unknown }).role === "assistant") &&
        typeof (message as { content?: unknown }).content === "string"
    )
  )
}

// 文件内容属于外部输入，即使由本程序生成，也要在载入时校验后再信任。
function isChatStoreData(value: unknown): value is ChatStoreData {
  if (
    value === null ||
    typeof value !== "object" ||
    (value as { version?: unknown }).version !== 1 ||
    typeof (value as { legacyImportedAt?: unknown }).legacyImportedAt !==
      "string" ||
    !Array.isArray((value as { conversations?: unknown }).conversations)
  ) {
    return false
  }
  return (value as ChatStoreData).conversations.every(
    (conversation) =>
      typeof conversation.id === "string" &&
      typeof conversation.title === "string" &&
      typeof conversation.createdAt === "string" &&
      typeof conversation.updatedAt === "string" &&
      Array.isArray(conversation.messages) &&
      conversation.messages.every(
        (message) =>
          typeof message.id === "string" &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string" &&
          ["streaming", "completed", "stopped", "failed"].includes(
            message.status
          ) &&
          typeof message.createdAt === "string"
      )
  )
}

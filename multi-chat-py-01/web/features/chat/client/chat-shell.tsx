"use client"

/**
 * Web 聊天页的客户端组合入口。
 *
 * 阅读顺序：查询/命令 -> 发送 Route -> ChatService -> GenerationManager ->
 * SSE Hook -> Query 缓存 -> MessageList。完整链路见 docs/ARCHITECTURE.md。
 */
import { useEffect, useState } from "react"

import {
  useConversation,
  useConversationCommands,
  useConversationList,
} from "../../../domains/conversation/client/queries"
import type { ConversationSummary } from "../../../domains/conversation/model"
import { MessageList } from "../../../domains/conversation/ui/message-list"
import { Sidebar } from "../../../domains/conversation/ui/sidebar"
import { requestJson } from "../../../shared/http-client"
import { Composer } from "./composer"
import { useGenerationStream } from "./use-generation-stream"
import { useSendMessage } from "./use-send-message"

/** 连接会话列表、消息详情、输入框与流式订阅；界面只持有选择状态，正文以查询缓存为准。 */
export function ChatShell() {
  // 仅属于界面的本地状态；会话和消息正文都以服务端数据为准。
  // undefined 表示自动选择最近会话；null 表示用户明确点了“新对话”，应显示空白页。
  const [selectedId, setSelectedId] = useState<string | null | undefined>()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system")

  // TanStack Query 管理会话服务端状态；activeId 是当前页面唯一的会话选择结果。
  const list = useConversationList()
  const conversations = list.data?.conversations ?? []
  const activeId =
    selectedId === null
      ? null
      : selectedId && conversations.some(({ id }) => id === selectedId)
        ? selectedId
        : (conversations[0]?.id ?? null)
  const detail = useConversation(activeId)
  const activeGenerationMessage = detail.data?.messages.findLast(
    (message) => message.status === "streaming" && message.generationId
  )

  // POST 只启动任务；真正的 token 由这个 SSE Hook 写回当前会话缓存。
  const connectionError = useGenerationStream(activeId, activeGenerationMessage)
  const { createConversation, renameConversation, deleteConversation } =
    useConversationCommands()
  const sendMessage = useSendMessage()

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light")
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  /** 有当前会话就复用，否则首次发送时才创建，避免仅点“新对话”就产生空历史。 */
  async function ensureConversation() {
    if (activeId) return activeId
    const conversation = await createConversation.mutateAsync()
    setSelectedId(conversation.id)
    return conversation.id
  }

  /** 给这次用户发送生成一个请求编号，再提交文本；网络重试由同一次 Mutation 沿用编号。 */
  async function handleSend(content: string) {
    const conversationId = await ensureConversation()
    await sendMessage.mutateAsync({
      conversationId,
      content,
      requestKey: crypto.randomUUID(),
    })
  }

  /** 用户主动重新生成原回答时使用新请求编号，服务端仍复用原助手消息位置。 */
  function handleRetry(messageId: string) {
    if (!activeId) return
    sendMessage.mutate({
      conversationId: activeId,
      retryAssistantMessageId: messageId,
      requestKey: crypto.randomUUID(),
    })
  }

  /** 切到空白输入页并收起移动端侧栏，不删除已有会话，也不立即写入空会话。 */
  function handleNew() {
    setSelectedId(null)
    setMobileOpen(false)
  }

  /** 切换当前会话，让详情查询和流订阅随 ID 切换，移动端同时收起侧栏。 */
  function handleSelect(id: string) {
    setSelectedId(id)
    setMobileOpen(false)
  }

  /** 只有输入了不同的非空标题才提交，最终长度校验仍在服务端执行。 */
  function handleRename(conversation: ConversationSummary) {
    const title = window.prompt("重命名会话", conversation.title)
    if (title && title !== conversation.title) {
      renameConversation.mutate({ id: conversation.id, title })
    }
  }

  /** 用户确认后删除会话，删除当前项才恢复自动选择最近会话。 */
  function handleDelete(conversation: ConversationSummary) {
    if (!window.confirm(`删除“${conversation.title}”？此操作无法撤销。`)) return
    deleteConversation.mutate(conversation.id, {
      onSuccess: () => {
        if (conversation.id === activeId) setSelectedId(undefined)
      },
    })
  }

  /** 请求服务端停止当前生成，页面最终状态由任务事件和历史查询更新。 */
  function handleStop() {
    if (!activeGenerationMessage?.generationId) return
    void requestJson<void>(
      `/api/generations/${activeGenerationMessage.generationId}`,
      { method: "DELETE" }
    )
  }

  const visibleError =
    connectionError ??
    (list.error instanceof Error ? list.error.message : null) ??
    (detail.error instanceof Error ? detail.error.message : null) ??
    (sendMessage.error instanceof Error ? sendMessage.error.message : null) ??
    (createConversation.error instanceof Error
      ? createConversation.error.message
      : null)

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--canvas)] text-[var(--text)]">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        mobileOpen={mobileOpen}
        collapsed={collapsed}
        onClose={() => setMobileOpen(false)}
        onNew={handleNew}
        onSelect={handleSelect}
        onRename={handleRename}
        onDelete={handleDelete}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between px-3 sm:px-5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="icon-button grid md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="打开侧栏"
            >
              ☰
            </button>
            <button
              type="button"
              className="icon-button hidden md:grid"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
            >
              ☰
            </button>
            <div>
              <div className="text-sm font-semibold">
                {activeId ? (detail.data?.title ?? "对话") : "新对话"}
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                {list.data?.model ?? "模型未配置"}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={() =>
              setTheme((value) =>
                value === "system"
                  ? "light"
                  : value === "light"
                    ? "dark"
                    : "system"
              )
            }
            aria-label="切换颜色主题"
          >
            {theme === "system"
              ? "跟随系统"
              : theme === "light"
                ? "浅色"
                : "深色"}
          </button>
        </header>
        {visibleError && (
          <div className="mx-auto mt-2 w-[calc(100%-2rem)] max-w-3xl rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
            {visibleError}
          </div>
        )}
        <MessageList
          conversation={activeId ? detail.data : null}
          loading={Boolean(activeId && detail.isPending)}
          retryDisabled={
            sendMessage.isPending || Boolean(activeGenerationMessage)
          }
          onRetry={handleRetry}
        />
        <Composer
          sending={sendMessage.isPending || createConversation.isPending}
          streaming={Boolean(activeGenerationMessage)}
          onSend={handleSend}
          onStop={handleStop}
        />
      </main>
    </div>
  )
}

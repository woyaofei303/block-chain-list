"use client"

/**
 * 浏览器侧生成订阅器：连接本机 SSE、断线续传、事件去重，并把 token 合并进
 * TanStack Query 的 Conversation 详情缓存。组件只消费缓存，不直接处理 SSE。
 */
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { conversationKeys } from "../../../domains/conversation/client/queries"
import type {
  ChatMessage,
  Conversation,
} from "../../../domains/conversation/model"
import type { GenerationEvent } from "../../../domains/generation/model"
import { fullJitterDelay } from "../../../shared/retry"
import { applyGenerationEvent } from "./apply-generation-event"

export function useGenerationStream(
  conversationId: string | null,
  message: ChatMessage | undefined
) {
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<{
    generationId: string
    message: string
  }>()
  const generationId = message?.generationId

  useEffect(() => {
    if (!conversationId || !generationId) return
    let source: EventSource | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let attempt = 0

    // Query 缓存是页面当前已应用事件的唯一进度来源，重连时把它作为 last-id 传回服务端。
    const currentLastEventId = () => {
      const cached = queryClient.getQueryData<Conversation>(
        conversationKeys.detail(conversationId)
      )
      return (
        cached?.messages.find((item) => item.generationId === generationId)
          ?.lastEventId ?? 0
      )
    }
    const apply = (type: GenerationEvent["type"], event: MessageEvent) => {
      const id = Number(event.lastEventId)
      const data = JSON.parse(event.data) as Record<string, unknown>
      queryClient.setQueryData<Conversation>(
        conversationKeys.detail(conversationId),
        (conversation) =>
          conversation
            ? {
                ...conversation,
                messages: conversation.messages.map((item) =>
                  item.generationId === generationId
                    ? applyGenerationEvent(item, { id, type, data })
                    : item
                ),
              }
            : conversation
      )
      attempt = 0
      if (type !== "delta") {
        source?.close()
        // 终态先由 SSE 即时更新界面，再重新读取磁盘中的权威结果和会话排序。
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
          queryClient.invalidateQueries({
            queryKey: conversationKeys.detail(conversationId),
          }),
        ])
      }
    }
    const connect = () => {
      if (disposed) return
      // 不依赖 EventSource 固定的内建重连节奏：每次重建连接都带 after，
      // 并在网络错误时使用带随机抖动的指数退避。
      source = new EventSource(
        `/api/generations/${generationId}?after=${currentLastEventId()}`
      )
      source.addEventListener("delta", (event) =>
        apply("delta", event as MessageEvent)
      )
      source.addEventListener("done", (event) =>
        apply("done", event as MessageEvent)
      )
      source.addEventListener("stopped", (event) =>
        apply("stopped", event as MessageEvent)
      )
      source.addEventListener("error", (event) => {
        // 服务端业务错误是带数据的 MessageEvent；普通 Event 才表示连接层断开。
        if (event instanceof MessageEvent) {
          apply("error", event)
          return
        }
        source?.close()
        void queryClient.invalidateQueries({
          queryKey: conversationKeys.detail(conversationId),
        })
        if (disposed) return
        if (attempt >= 5) {
          setFailure({
            generationId,
            message: "连接中断，请刷新页面后继续。",
          })
          return
        }
        reconnectTimer = setTimeout(connect, fullJitterDelay(attempt++))
      })
    }

    connect()
    return () => {
      disposed = true
      source?.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [conversationId, generationId, queryClient])

  return failure && failure.generationId === generationId
    ? failure.message
    : null
}

"use client"

/**
 * Conversation 领域的浏览器数据入口。
 *
 * 这里把会话 CRUD 包装成 Query/Mutation，并负责失效缓存；跨领域的“发送消息”
 * 单独位于 features/chat/client/use-send-message.ts。
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { requestJson } from "../../../shared/http-client"
import type { Conversation, ConversationSummary } from "../model"

type ConversationList = {
  model: string
  conversations: ConversationSummary[]
}

export const conversationKeys = {
  all: ["conversations"] as const,
  detail: (id: string | null) => ["conversation", id] as const,
}

/** 读取侧栏摘要并放进共享缓存，创建或改名后通过失效查询刷新排序。 */
export function useConversationList() {
  return useQuery({
    queryKey: conversationKeys.all,
    queryFn: () => requestJson<ConversationList>("/api/conversations"),
  })
}

/** 只在选中会话后读取详情，每个 ID 使用独立缓存，切换会话不会混合消息。 */
export function useConversation(id: string | null) {
  return useQuery({
    queryKey: conversationKeys.detail(id),
    queryFn: () => requestJson<Conversation>(`/api/conversations/${id}`),
    enabled: Boolean(id),
  })
}

/** 把创建、改名、删除交给服务端；成功后刷新列表，删除还要移除对应详情缓存。 */
export function useConversationCommands() {
  const queryClient = useQueryClient()
  const createConversation = useMutation({
    mutationFn: () =>
      requestJson<Conversation>("/api/conversations", { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
  })
  const renameConversation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      requestJson<Conversation>(`/api/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
  })
  const deleteConversation = useMutation({
    mutationFn: (id: string) =>
      requestJson<void>(`/api/conversations/${id}`, { method: "DELETE" }),
    onSuccess: async (_data, id) => {
      queryClient.removeQueries({ queryKey: conversationKeys.detail(id) })
      await queryClient.invalidateQueries({ queryKey: conversationKeys.all })
    },
  })

  return {
    createConversation,
    renameConversation,
    deleteConversation,
  }
}

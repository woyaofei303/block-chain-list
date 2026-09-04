"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  isRetryableClientError,
  requestJson,
} from "../../../shared/http-client"
import { fullJitterDelay } from "../../../shared/retry"
import type { Conversation, ConversationSummary } from "../model"

type ConversationList = {
  model: string
  conversations: ConversationSummary[]
}

export type SendMessageInput = {
  conversationId: string
  content?: string
  retryAssistantMessageId?: string
  requestKey: string
}

export const conversationKeys = {
  all: ["conversations"] as const,
  detail: (id: string | null) => ["conversation", id] as const,
}

export function useConversationList() {
  return useQuery({
    queryKey: conversationKeys.all,
    queryFn: () => requestJson<ConversationList>("/api/conversations"),
  })
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: conversationKeys.detail(id),
    queryFn: () => requestJson<Conversation>(`/api/conversations/${id}`),
    enabled: Boolean(id),
  })
}

export function useConversationCommands() {
  const queryClient = useQueryClient()
  const createConversation = useMutation({
    mutationFn: () =>
      requestJson<Conversation>("/api/conversations", { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
  })
  const sendMessage = useMutation({
    mutationFn: (input: SendMessageInput) =>
      requestJson<unknown>(
        `/api/conversations/${input.conversationId}/messages`,
        { method: "POST", body: JSON.stringify(input) }
      ),
    // 同一次 Mutation 重试时 input 不变，服务端可用 requestKey 幂等去重。
    retry: (failureCount, error) =>
      failureCount < 2 && isRetryableClientError(error),
    retryDelay: (attempt) => fullJitterDelay(attempt),
    onSuccess: async (_result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: conversationKeys.all }),
        queryClient.invalidateQueries({
          queryKey: conversationKeys.detail(input.conversationId),
        }),
      ])
    },
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
    sendMessage,
    renameConversation,
    deleteConversation,
  }
}

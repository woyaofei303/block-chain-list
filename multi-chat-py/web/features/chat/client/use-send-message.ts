"use client"

/**
 * “发送/重试回答”的客户端用例入口。
 *
 * 它属于 Chat feature，因为一次发送同时影响 Conversation 和 Generation；成功后
 * 只需刷新会话缓存，SSE 订阅由 ChatShell 根据新的 streaming 消息自动启动。
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { conversationKeys } from "../../../domains/conversation/client/queries"
import {
  isRetryableClientError,
  requestJson,
} from "../../../shared/http-client"
import { fullJitterDelay } from "../../../shared/retry"
import type { SendMessageRequest, SendMessageResult } from "../contracts"

export function useSendMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ conversationId, ...command }: SendMessageRequest) =>
      requestJson<SendMessageResult>(
        `/api/conversations/${conversationId}/messages`,
        { method: "POST", body: JSON.stringify(command) }
      ),
    // 同一次 Mutation 重试时 command 不变，服务端用 requestKey 幂等去重。
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
}

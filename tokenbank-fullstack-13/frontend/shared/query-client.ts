import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { errors } from "./error-queue.ts"
import { AppError, asAppError, retryQuery } from "./errors.ts"

/** 缓存层集中收集最终失败：多个组件订阅同一个查询，也只从这里向错误队列报告一次。 */
export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (cause, query) => {
        const error = asAppError(cause)
        const severity = error.code.startsWith("AUTH_") || error.code === "HTTP_401" ? 1 : 0
        errors.report(
          new AppError(error.kind, error.code, error.message, {
            severity,
            retryable: error.retryable,
            requestId: error.requestId,
          }),
          query.queryHash
        )
      },
      onSuccess: (_data, query) => errors.recover(query.queryHash),
    }),
    mutationCache: new MutationCache({
      // 新一轮主动操作允许再次提示；后台轮询失败则保持抑制，直到对应查询恢复成功。
      onMutate: (_variables, mutation) =>
        errors.recover(JSON.stringify(mutation.options.mutationKey ?? ["write"])),
      onError: (cause, _variables, _context, mutation) => {
        const error = asAppError(cause)
        errors.report(
          new AppError(error.kind, error.code, error.message, {
            severity: error.severity === 2 ? 2 : 1,
            requestId: error.requestId,
          }),
          JSON.stringify(mutation.options.mutationKey ?? ["write"]),
          true
        )
      },
      onSuccess: (_data, _variables, _context, mutation) =>
        errors.recover(JSON.stringify(mutation.options.mutationKey ?? ["write"])),
    }),
    defaultOptions: {
      // 查询仅对可恢复错误重试一次；退避由 TanStack 管理，下次调用 request 时重新排队。
      queries: { retry: retryQuery, retryDelay: 1_000, staleTime: 5_000 },
      mutations: { retry: false },
    },
  })
}

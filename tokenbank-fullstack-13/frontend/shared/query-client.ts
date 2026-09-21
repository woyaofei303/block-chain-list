import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { errors } from "./error-queue.ts"
import { AppError, asAppError, retryQuery } from "./errors.ts"

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
      queries: { retry: retryQuery, retryDelay: 1_000, staleTime: 5_000 },
      mutations: { retry: false },
    },
  })
}

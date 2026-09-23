import { BaseError, HttpRequestError, TimeoutError } from "viem"

export type ErrorKind = "network" | "timeout" | "http" | "business" | "cancelled"
export class AppError extends Error {
  kind: ErrorKind
  code: string
  severity: 0 | 1 | 2
  retryable: boolean
  requestId?: string
  constructor(
    kind: ErrorKind,
    code: string,
    message: string,
    options: {
      severity?: 0 | 1 | 2
      retryable?: boolean
      requestId?: string
    } = {}
  ) {
    super(message)
    this.name = "AppError"
    this.kind = kind
    this.code = code
    this.severity = options.severity ?? 0
    this.retryable = options.retryable ?? false
    this.requestId = options.requestId
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof DOMException && error.name === "AbortError")
    return new AppError("cancelled", "CANCELLED", "已终止等待，已提交的业务不会因此撤销")
  if (error instanceof BaseError) {
    if (
      error.walk(
        (cause) => !!cause && typeof cause === "object" && "code" in cause && cause.code === 4001
      )
    )
      return new AppError("cancelled", "WALLET_REJECTED", "已取消钱包请求")
    if (error.walk((cause) => cause instanceof HttpRequestError || cause instanceof TimeoutError))
      return new AppError("network", "RPC_UNAVAILABLE", "链上查询连接失败，请稍后重试", {
        retryable: true,
      })
    return new AppError("business", "CHAIN_ERROR", "链上操作未完成，请核对钱包记录", {
      severity: 1,
    })
  }
  return new AppError(
    "business",
    "OPERATION_FAILED",
    error instanceof Error ? error.message : "操作失败，请重试",
    { severity: 1 }
  )
}

export function retryQuery(count: number, error: unknown) {
  return count < 1 && asAppError(error).retryable
}

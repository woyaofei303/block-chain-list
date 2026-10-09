import { BaseError, HttpRequestError, TimeoutError } from "viem"

export type ErrorKind = "network" | "timeout" | "http" | "business" | "cancelled"
export class AppError extends Error {
  kind: ErrorKind
  code: string
  severity: 0 | 1 | 2
  retryable: boolean
  requestId?: string
  /** 把错误原因与提示等级、重试资格放在一起，页面无需按错误文案猜处理方式。 */
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

/** 统一 HTTP、RPC、钱包拒绝与取消的表示；用户取消不当成失败提示，网络故障才考虑查询重试。 */
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

/** 只让可恢复的查询失败再试一次；交易写入不应套用这条自动重试规则。 */
export function retryQuery(count: number, error: unknown) {
  return count < 1 && asAppError(error).retryable
}

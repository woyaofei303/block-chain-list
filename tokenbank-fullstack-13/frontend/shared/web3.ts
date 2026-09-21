import { BaseError } from "viem"

export function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof BaseError) {
    const rejected = error.walk(
      (cause) => !!cause && typeof cause === "object" && "code" in cause && cause.code === 4001
    )
    if (rejected) return "已取消钱包请求，请在钱包中确认后重试。"
    if (error.name === "WaitForTransactionReceiptTimeoutError")
      return "确认等待超时，请先查看钱包中的交易状态再决定是否重试。"
    return error.shortMessage
  }
  return error instanceof Error ? error.message : "操作失败，请重试"
}

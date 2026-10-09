import { BaseError } from "viem"

/** 把长地址缩短用于展示；调用合约、校验身份和生成链接仍使用完整地址。 */
export function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

/** 给界面返回可读原因；钱包拒绝和等待超时单独说明，超时不能被解释为链上失败。 */
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

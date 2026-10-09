/** 浏览器通用 JSON 请求边界：规范化错误，并为调用者暴露可重试判定。 */
import { isRetryableStatus } from "./retry.ts"

export class ApiError extends Error {
  status: number

  /** 保留状态码供重试规则判断，展示文案由服务端错误或通用提示提供。 */
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** 统一 JSON 请求与 HTTP 错误；204 没有响应体，类型参数只供编译检查，不代替运行时校验。 */
export async function requestJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown
    } | null
    throw new ApiError(
      response.status,
      typeof body?.error === "string"
        ? body.error
        : `请求失败（${response.status}）`
    )
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

/** 仅把网络故障和约定的临时状态交给重试，参数错误或业务冲突应让用户处理。 */
export function isRetryableClientError(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof ApiError && isRetryableStatus(error.status))
  )
}

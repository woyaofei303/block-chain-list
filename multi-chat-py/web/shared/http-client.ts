import { isRetryableStatus } from "./retry.ts"

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

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

export function isRetryableClientError(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof ApiError && isRetryableStatus(error.status))
  )
}

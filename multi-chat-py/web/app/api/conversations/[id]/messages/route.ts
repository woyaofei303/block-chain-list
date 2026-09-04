import { runtime as appRuntime } from "@/server/runtime"
import {
  errorResponse,
  readJsonObject,
  requiredIdentifier,
} from "@/shared/http-server"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

/**
 * 先持久化用户消息和助手占位，再在后台启动生成；浏览器随后通过独立的 GET SSE
 * 接口接收 token。这样 POST 可安全返回 generationId，也符合 EventSource 只支持 GET 的限制。
 */
export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonObject(request)
    const requestKey = requiredIdentifier(body.requestKey, "requestKey")
    const retryAssistantMessageId = body.retryAssistantMessageId
      ? requiredIdentifier(body.retryAssistantMessageId, "消息 ID")
      : null
    const result = await appRuntime.chat.sendMessage(
      id,
      retryAssistantMessageId
        ? { retryAssistantMessageId, requestKey }
        : { content: validContent(body.content), requestKey }
    )

    return Response.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}

function validContent(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("消息不能为空")
  }
  if (value.length > 32_000) {
    throw new Error("消息长度不能超过 32000 个字符")
  }
  return value
}

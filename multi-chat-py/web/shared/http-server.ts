/** Route 共用的输入读取与错误响应适配；不包含聊天领域逻辑。 */

/** 将领域错误转换为稳定的 HTTP 响应，同时隐藏未预期的内部异常。 */
export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "请求失败"
  if (message.includes("不存在")) {
    return Response.json({ error: message }, { status: 404 })
  }
  if (message.includes("正在生成")) {
    return Response.json({ error: message }, { status: 409 })
  }
  if (
    message.includes("不能为空") ||
    message.includes("长度") ||
    message === "请求格式无效" ||
    message === "标题格式无效" ||
    message.startsWith("requestKey格式") ||
    message.startsWith("消息 ID格式")
  ) {
    return Response.json({ error: message }, { status: 400 })
  }
  // 未归类异常只记录在服务端，不把模型响应、路径或内部堆栈泄露给浏览器。
  console.error("Request failed", error)
  return Response.json({ error: "服务器内部错误" }, { status: 500 })
}

export async function readJsonObject(request: Request) {
  const value: unknown = await request.json().catch(() => null)
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求格式无效")
  }
  return value as Record<string, unknown>
}

export function requiredIdentifier(value: unknown, name: string) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !/^[\w.:-]+$/.test(value)
  ) {
    throw new Error(`${name}格式无效`)
  }
  return value
}

/** GET/POST /api/conversations：会话列表与新建会话的 HTTP 适配层。 */
import { runtime as appRuntime, configuredModel } from "@/server/runtime"
import { errorResponse } from "@/shared/http-server"

export const runtime = "nodejs"

/** 给侧栏返回模型名和会话 ID、标题，避免列表请求携带所有消息正文。 */
export async function GET() {
  try {
    const conversations = await appRuntime.store.listConversations()
    return Response.json({
      model: configuredModel(),
      conversations: conversations.map(({ id, title }) => ({ id, title })),
    })
  } catch (error) {
    console.error("Failed to list conversations", error)
    return Response.json({ error: "读取会话失败" }, { status: 500 })
  }
}

/** 创建并保存一个空会话，返回 201；真正模型生成要等后续发送消息。 */
export async function POST() {
  try {
    return Response.json(await appRuntime.store.createConversation(), {
      status: 201,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

import { runtime as appRuntime, configuredModel } from "@/server/runtime"
import { errorResponse } from "@/shared/http-server"

export const runtime = "nodejs"

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

export async function POST() {
  try {
    return Response.json(await appRuntime.store.createConversation(), {
      status: 201,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

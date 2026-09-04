import { runtime as appRuntime } from "@/server/runtime"
import { errorResponse, readJsonObject } from "@/shared/http-server"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params
    const conversation = await appRuntime.store.getConversation(id)
    if (!conversation) throw new Error("会话不存在")
    return Response.json(conversation)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params
    const body = await readJsonObject(request)
    if (typeof body.title !== "string") throw new Error("标题格式无效")
    return Response.json(
      await appRuntime.store.renameConversation(id, body.title)
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params
    await appRuntime.chat.deleteConversation(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}

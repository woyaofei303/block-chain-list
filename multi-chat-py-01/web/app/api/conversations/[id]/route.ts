/** GET/PATCH/DELETE /api/conversations/:id：会话详情、改名和删除的 HTTP 适配层。 */
import { runtime as appRuntime } from "@/server/runtime"
import { errorResponse, readJsonObject } from "@/shared/http-server"

export const runtime = "nodejs"

type Context = { params: Promise<{ id: string }> }

/** 读取指定会话，缺失时返回 404；这里读的是已保存历史，不建立模型连接。 */
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

/** 只接收字符串标题，再交给仓库检查长度并保存；失败返回统一错误。 */
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

/** 经用例服务停止生成并删除历史，完成后返回无正文的 204。 */
export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params
    await appRuntime.chat.deleteConversation(id)
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(error)
  }
}

import { proxy } from "../../../../shared/proxy.ts"
export const dynamic = "force-dynamic"
/** 只转发列出的认证和操作接口；浏览器走本站路径，避免把后端地址或任意代理能力暴露给客户端。 */
function forward(request: Request) {
  const path = new URL(request.url).pathname.slice("/api/backend".length)
  if (
    !/^\/(auth\/(challenge|verify|session)|operations(?:\/0x[\da-f]{64}(?:\/transactions)?)?)$/i.test(
      path
    )
  )
    return Response.json({ error: "Not found" }, { status: 404 })
  return proxy(request, path)
}
export const GET = forward
export const POST = forward

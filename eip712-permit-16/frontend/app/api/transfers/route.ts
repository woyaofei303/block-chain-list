import { proxy } from "../../../shared/proxy.ts"
export const dynamic = "force-dynamic"
/** 把分页查询转发给索引器，保留原查询参数；校验与金额格式化仍由后端负责。 */
export function GET(request: Request) {
  return proxy(request, `/transfers${new URL(request.url).search}`)
}

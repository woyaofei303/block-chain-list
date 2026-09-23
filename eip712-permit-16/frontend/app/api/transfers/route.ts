import { proxy } from "../../../shared/proxy.ts"
export const dynamic = "force-dynamic"
export function GET(request: Request) {
  return proxy(request, `/transfers${new URL(request.url).search}`)
}

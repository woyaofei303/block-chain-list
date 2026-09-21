/** App Router 页面入口；交互从 ChatShell 开始，服务端能力通过 /api Route 暴露。 */
import { ChatShell } from "@/features/chat/client/chat-shell"

export default function Home() {
  return <ChatShell />
}

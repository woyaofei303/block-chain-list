/** App Router 页面入口；交互从 ChatShell 开始，服务端能力通过 /api Route 暴露。 */
import { ChatShell } from "@/features/chat/client/chat-shell"

/** 挂载聊天工作区，服务端历史和生成能力通过独立 API 获取。 */
export default function Home() {
  return <ChatShell />
}

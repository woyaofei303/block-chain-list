import type { Metadata } from "next"

import { Providers } from "@/app/providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Multi Chat",
  description: "本机多轮 AI 对话客户端",
}

/** 设置中文页面骨架并注入共享查询上下文，所有聊天组件使用同一份缓存。 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

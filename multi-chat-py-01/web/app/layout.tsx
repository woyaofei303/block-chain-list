import type { Metadata } from "next"

import { Providers } from "@/app/providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Multi Chat",
  description: "本机多轮 AI 对话客户端",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

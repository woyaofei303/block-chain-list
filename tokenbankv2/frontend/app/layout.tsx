import type { Metadata } from "next"

import { Providers } from "@/app/providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Token Bank · 我的资产",
  description: "连接钱包，查看 Token 余额，管理 TokenBank 存款与转账记录。",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

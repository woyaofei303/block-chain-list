import type { Metadata } from "next"

import { Providers } from "@/app/providers"
import "./globals.css"

export const metadata: Metadata = {
  title: "Token Bank · 我的资产",
  description: "连接钱包，查看 Token 余额，管理 TokenBank 存款与转账记录。",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Bybit 等钱包会在 React 接管前注入 html 属性；仅容忍根元素差异，子组件仍执行 hydration 校验。
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

import { BankClient } from "@/features/bank-dashboard"

/** 页面入口只挂载银行界面，钱包会话和查询状态由客户端组件管理。 */
export default function Home() {
  return <BankClient />
}

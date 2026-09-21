"use client"

import { useState } from "react"
import { useConnection } from "wagmi"
import { targetChain } from "@/domains/wallet/config"
import { WalletButton } from "@/domains/wallet/wallet-button"
import { BankWorkspace } from "./bank-workspace"

/** app/page.tsx 的客户端入口：维护银行地址和页面布局，操作流程交给 BankWorkspace。 */
export function BankClient() {
  const connection = useConnection()
  const [bankAddress, setBankAddress] = useState(process.env.NEXT_PUBLIC_BANK_ADDRESS ?? "")
  // 会话切换时重建工作区，金额、历史分页和旧交易提示不串到新账户。
  const sessionKey = `${connection.address}:${connection.chainId}:${connection.connector?.uid}:${bankAddress}`
  return (
    <>
      <header className="flex h-[84px] items-center gap-[42px] border-b border-[#f6f5f7] px-9 mobile:h-[72px] mobile:flex-wrap mobile:gap-5 mobile:px-[18px] compact:gap-3">
        <a
          href="#bank"
          className="flex items-center gap-2.5 text-[20px] font-bold tracking-[-0.8px] whitespace-nowrap mobile:gap-1.5 mobile:text-[17px] compact:text-[15px] compact:[&>span:last-child]:hidden"
          aria-label="Token Bank 首页"
        >
          <span
            className="text-[42px] leading-none font-normal text-accent mobile:text-[34px] compact:text-[28px]"
            aria-hidden="true"
          >
            ✳
          </span>
          <span>Token Bank</span>
        </a>
        <nav
          aria-label="主导航"
          className="flex gap-[30px] text-[15px] text-muted mobile:gap-4 mobile:text-[13px] compact:gap-2.5"
        >
          <a className="font-semibold text-heading" href="#bank">
            存取
          </a>
          <a href="#activity">记录</a>
        </nav>
        <div className="ml-auto flex items-center gap-[22px] mobile:gap-2.5">
          <span className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap mobile:hidden">
            <span className="size-[9px] rounded-full bg-[#8292f3] shadow-[0_0_0_4px_#f3f3ff]" />
            {connection.isConnected
              ? (connection.chain?.name ?? `网络 ${connection.chainId}`)
              : "未连接"}
          </span>
          <WalletButton />
        </div>
      </header>
      <main
        id="bank"
        className="bg-[radial-gradient(ellipse_470px_340px_at_50%_230px,#fff7fc,transparent)] px-5 pt-11 mobile:px-4 mobile:pt-[34px]"
      >
        <div className="mb-[30px] text-center mobile:mb-[26px]">
          <p className="mb-3 text-[10px] font-medium tracking-[2.3px] text-[#9d8d99] mobile:text-[9px]">
            YOUR TOKENS. YOUR CONTROL.
          </p>
          <h1 className="text-[clamp(28px,3.4vw,43px)] leading-[1.45] font-[650] tracking-[-2px] mobile:text-[30px] mobile:tracking-[-1.4px] compact:text-[26px]">
            你的资产，<span className="text-[#d92aab]">随存随取。</span>
          </h1>
          <p className="mt-2.5 text-[14px] text-muted mobile:text-[12px]">
            从钱包到银行，每一笔都由你掌控。
          </p>
        </div>
        <BankWorkspace key={sessionKey} bankAddress={bankAddress} onBankChange={setBankAddress} />
      </main>
      <footer className="flex justify-between gap-4 px-9 pt-[30px] pb-[22px] text-[12px] mobile:px-4 mobile:py-[22px]">
        <a href="#bank" className="text-muted">
          Token Bank
        </a>
        <span className="text-[12px] text-muted">{targetChain.name} · 链上余额，随时可查</span>
      </footer>
    </>
  )
}

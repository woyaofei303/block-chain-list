import type { JSX } from "react"
import { formatUnits, isAddress, zeroAddress } from "viem"
import { explorerLink } from "@/domains/wallet/config"
import { shortAddress } from "@/shared/web3"
import type { Snapshot } from "./client"

type BankBalancesProps = {
  bankAddress: string
  snapshot?: Snapshot
}

/** 共用工作区读到的链上快照，不另发请求；缺少快照显示“—”，不能将查询失败显示成零余额。 */
export function BankBalances({ bankAddress, snapshot }: BankBalancesProps): JSX.Element {
  const validBank = isAddress(bankAddress) && bankAddress !== zeroAddress
  const symbol = snapshot?.symbol ?? "TOKEN"
  const formatted = (value: bigint) => formatUnits(value, snapshot?.decimals ?? 18)

  return (
    <>
      <section
        className="mx-auto mt-[22px] grid w-full max-w-[640px] grid-cols-3 gap-5 px-4 mobile:grid-cols-1 mobile:gap-3 mobile:px-2"
        aria-label="钱包与银行资产"
      >
        {(
          [
            ["我的钱包余额", snapshot?.walletBalance, "wallet-balance"],
            ["我的银行存款", snapshot?.deposited, "bank-balance"],
            ["银行总资产", snapshot?.bankAssets, "bank-assets"],
          ] as const
        ).map(([label, value, testId], index) => (
          <div
            key={testId}
            className={`mobile:flex mobile:items-baseline mobile:justify-between mobile:gap-4 ${index ? "border-l border-line pl-5 mobile:border-t mobile:border-l-0 mobile:pt-3 mobile:pl-0" : ""}`}
          >
            <span className="text-[12px] text-muted mobile:shrink-0">{label}</span>
            <p
              className="mt-[5px] text-[17px] font-[550] wrap-anywhere mobile:text-[15px]"
              data-testid={testId}
            >
              {value !== undefined ? formatted(value) : "—"}
              <span className="text-[12px] text-muted mobile:shrink-0">
                {" "}
                {snapshot ? symbol : ""}
              </span>
            </p>
          </div>
        ))}
      </section>
      <p className="px-1 pt-3.5 pb-1.5 text-center text-[11px] text-[#827787]">
        银行总资产为该合约持有的代币总量；你只能取出自己的银行存款。
      </p>
      <div className="mx-auto mt-5 flex flex-wrap justify-center gap-5 text-[11px] text-muted [&_a]:text-[#7c7280]">
        <span>
          银行{" "}
          <a
            href={validBank ? explorerLink("address", bankAddress) : undefined}
            title={bankAddress}
            target="_blank"
            rel="noreferrer"
          >
            {validBank ? shortAddress(bankAddress) : "尚未配置"}
          </a>
        </span>
        {snapshot && (
          <span>
            Token{" "}
            <a
              href={explorerLink("address", snapshot.token)}
              title={snapshot.token}
              target="_blank"
              rel="noreferrer"
            >
              {shortAddress(snapshot.token)}
            </a>
          </span>
        )}
      </div>
    </>
  )
}

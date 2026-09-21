import type { JSX } from "react"
import { type Address, formatUnits } from "viem"
import { shortAddress } from "@/shared/web3"
import type { Snapshot } from "./client"

type AmountFieldsProps = {
  action: "deposit" | "withdraw"
  amount: string
  onAmountChange: (amount: string) => void
  account?: Address
  snapshot?: Snapshot
  available: bigint
  parsed: bigint
  amountError: string
  disabled: boolean
  savedAmount?: string
}

export function AmountFields({
  action,
  amount,
  onAmountChange,
  account,
  snapshot,
  available,
  parsed,
  amountError,
  disabled,
  savedAmount,
}: AmountFieldsProps): JSX.Element {
  const deposit = action === "deposit"
  const symbol = snapshot?.symbol ?? "TOKEN"
  const formatted = (value: bigint) => formatUnits(value, snapshot?.decimals ?? 18)
  const walletLabel = account ? shortAddress(account) : "我的钱包"
  const recipient = deposit ? "Token Bank" : walletLabel
  let description = "到账金额与输入金额一致"
  if (savedAmount !== undefined) {
    description = `已保存的${deposit ? "存款" : "取款"}金额 ${savedAmount} ${symbol}`
  } else if (snapshot && !amountError) {
    const resultingBalance = snapshot.deposited + (deposit ? parsed : -parsed)
    description = `完成后我的银行存款 ${formatted(resultingBalance)} ${symbol}`
  }

  return (
    <>
      <div className="rounded-[20px] border border-transparent bg-[#f8f7f9] px-5 py-[18px] focus-within:border-[#e9d6e5] mobile:p-4">
        <label htmlFor="amount" className="text-[14px] text-muted">
          {deposit ? "从钱包存入" : "从银行取出"}
        </label>
        <div className="mt-2.5 mb-2 flex items-center gap-4">
          <input
            id="amount"
            className="w-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-[38px] font-normal tracking-[-1px] text-[#242127] outline-none placeholder:text-[#b5b1ba] mobile:text-[34px]"
            name="amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            disabled={!snapshot || disabled}
            aria-invalid={!!amountError}
            aria-describedby="amount-error"
            onChange={(event) => onAmountChange(event.target.value)}
          />
          <span className="inline-flex max-w-[55%] shrink-0 items-center gap-[7px] rounded-[30px] border border-[#eeebf0] bg-white py-[5px] pr-2.5 pl-[5px] text-[16px] font-semibold wrap-anywhere mobile:text-[13px]">
            <span
              className="grid size-[25px] shrink-0 place-items-center rounded-full bg-[#ede8fc] text-[13px] text-[#9072d7]"
              aria-hidden="true"
            >
              T
            </span>
            {symbol}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2.5">
          <span className="text-[12px] text-muted wrap-anywhere">
            {deposit ? "钱包余额" : "可提余额"} {snapshot ? formatted(available) : "—"}
          </span>
          <button
            type="button"
            className="shrink-0 border-0 bg-transparent text-[12px] font-semibold text-[#dc11a4]"
            disabled={!snapshot || disabled || available === 0n}
            onClick={() => onAmountChange(formatted(available))}
          >
            全部
          </button>
        </div>
      </div>
      <div
        className="relative z-1 mx-auto -my-3 grid size-9 place-items-center rounded-xl border-4 border-white bg-[#f3f1f5] text-[#6b6470]"
        aria-hidden="true"
      >
        ↓
      </div>
      <div className="rounded-[20px] bg-[#fbf9fc] px-5 pt-[19px] pb-[18px] mobile:p-4">
        <span className="text-[14px] text-muted">{deposit ? "存入银行" : "返回钱包"}</span>
        <div className="my-2 flex items-center justify-between gap-3">
          <span
            className={`min-w-0 text-[34px] leading-[1.4] tracking-[-0.8px] wrap-anywhere mobile:text-[29px] ${!parsed ? "text-[#b5b1ba]" : ""}`}
          >
            {parsed ? formatted(parsed) : "0"}
          </span>
          <span className="shrink-0 text-[13px] text-[#7c7280] mobile:text-[12px]">
            {recipient}
            <span aria-hidden="true"> ↗</span>
          </span>
        </div>
        <p className="text-[14px] wrap-anywhere text-muted">{description}</p>
      </div>
      <p
        id="amount-error"
        className="text-[12px] wrap-anywhere text-[#bc3654] not-empty:px-1 not-empty:py-2.5"
        role={amountError ? "alert" : undefined}
      >
        {amountError}
      </p>
    </>
  )
}

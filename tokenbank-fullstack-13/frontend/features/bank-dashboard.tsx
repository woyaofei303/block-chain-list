"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useRef, useState } from "react"
import {
  type Address,
  type EIP1193Provider,
  formatUnits,
  type Hash,
  isAddress,
  zeroAddress,
} from "viem"
import { useConnection, useSwitchChain } from "wagmi"
import { getConnection } from "wagmi/actions"
import { createBank, parseAmount } from "@/domains/bank/client"
import {
  executeIntent,
  type Intent,
  intentKey,
  newOperationId,
  restoreIntent,
  saveIntent,
} from "@/domains/operations/client"
import { TransferHistory } from "@/domains/transfers/transfer-history"
import { explorerLink, targetChain, wagmiConfig } from "@/domains/wallet/config"
import { WalletButton } from "@/domains/wallet/wallet-button"
import { errors } from "@/shared/error-queue"
import { asAppError } from "@/shared/errors"
import { errorMessage, shortAddress } from "@/shared/web3"

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

function BankWorkspace({
  bankAddress,
  onBankChange,
}: {
  bankAddress: string
  onBankChange: (address: string) => void
}) {
  const { address, chainId, connector, isConnected } = useConnection()
  const switchChain = useSwitchChain()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<"deposit" | "withdraw">("deposit")
  const [amount, setAmount] = useState("")
  const [intent, setIntent] = useState<Intent>()
  const [stopped, setStopped] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const execution = useRef<AbortController | null>(null)
  const [status, setStatus] = useState<{
    message: string
    tone: string
    hash?: Hash
  }>()
  const [draft, setDraft] = useState(bankAddress)
  const [settingsError, setSettingsError] = useState("")
  const settings = useRef<HTMLDialogElement>(null)
  const active = useRef(true)
  const locked = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      execution.current?.abort()
    }
  }, [])
  const validBank = isAddress(bankAddress) && bankAddress !== zeroAddress
  const enabled = isConnected && chainId === targetChain.id && validBank

  async function bank(signal?: AbortSignal) {
    if (!address || !connector || !validBank) throw new Error("请先连接钱包并配置银行合约")
    const provider = (await connector.getProvider()) as EIP1193Provider
    return createBank(provider, targetChain.id, bankAddress as Address, address, isCurrent, signal)
  }

  function isCurrent() {
    const current = getConnection(wagmiConfig)
    return (
      active.current &&
      current.address === address &&
      current.chainId === targetChain.id &&
      current.connector?.uid === connector?.uid
    )
  }
  useEffect(() => {
    if (!address || !isAddress(bankAddress)) return
    try {
      const saved = restoreIntent(localStorage, address, targetChain.id, bankAddress)
      if (saved) {
        setIntent(saved)
        setAction(saved.action)
        setAmount(saved.amount)
        setStopped(true)
        setStatus({
          message: "已恢复上次操作。请核实结果，或使用原操作继续。",
          tone: "info",
          hash: saved.businessHash ?? saved.approvalHash,
        })
      }
    } catch (error) {
      setStorageError(true)
      setStatus({ message: errorMessage(error), tone: "error" })
    }
  }, [address, bankAddress])
  const mutation = useMutation({
    mutationKey: ["bank-operation", targetChain.id, bankAddress, address],
    mutationFn: async ({ value, send }: { value: Intent; send: boolean }) => {
      const controller = execution.current
      if (!controller || !connector) throw new Error("请连接钱包")
      const provider = (await connector.getProvider()) as EIP1193Provider
      return executeIntent(value, {
        provider,
        signal: controller.signal,
        isCurrent,
        send,
        persist: (saved) => {
          saveIntent(localStorage, saved)
          if (active.current) setIntent(saved)
        },
        progress: (message) => {
          if (active.current && !controller.signal.aborted) setStatus({ message, tone: "info" })
        },
      })
    },
    onSuccess: (saved) => {
      if (!isCurrent() || execution.current?.signal.aborted) return
      setStopped(false)
      setStatus({
        message: "业务已确认。转账记录将在索引完成后显示。",
        tone: "success",
        hash: saved.businessHash,
      })
      void queryClient.invalidateQueries({
        queryKey: ["balance", targetChain.id, bankAddress.toLowerCase(), address?.toLowerCase()],
      })
      void queryClient.invalidateQueries({ queryKey: ["transfers", targetChain.id] })
    },
    onError: (cause) => {
      if (active.current) setStatus({ message: asAppError(cause).message, tone: "error" })
    },
    onSettled: () => {
      locked.current = false
    },
  })
  const busy = mutation.isPending
  const balanceKey = [
    "balance",
    targetChain.id,
    bankAddress.toLowerCase(),
    address?.toLowerCase(),
    connector?.uid,
  ]
  const balance = useQuery({
    queryKey: balanceKey,
    enabled: enabled && !stopped,
    queryFn: async ({ signal }) => (await bank(signal)).read(),
    refetchInterval: busy || stopped ? false : 15_000,
  })
  const snapshot = enabled && !balance.isError ? balance.data : undefined
  const available = snapshot
    ? action === "deposit"
      ? snapshot.walletBalance
      : snapshot.deposited
    : 0n
  let amountError = ""
  let parsed = 0n
  if (amount && snapshot) {
    try {
      parsed = parseAmount(amount, snapshot.decimals, available)
    } catch (cause) {
      amountError = errorMessage(cause)
    }
  }
  const symbol = snapshot?.symbol ?? "TOKEN"
  const deposit = action === "deposit"
  const formatted = (value: bigint) => formatUnits(value, snapshot?.decimals ?? 18)
  const resultingBalance = snapshot ? snapshot.deposited + (deposit ? parsed : -parsed) : undefined

  function openSettings() {
    setDraft(bankAddress)
    setSettingsError("")
    settings.current?.showModal()
  }

  function run(value: Intent, send: boolean) {
    if (locked.current) return
    locked.current = true
    execution.current = new AbortController()
    // 用户明确继续才开启新的执行上下文；自动轮询仍等待本次成功后恢复。
    mutation.mutate({ value, send })
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      locked.current ||
      intent ||
      storageError ||
      !address ||
      !validBank ||
      !snapshot?.idempotent ||
      !parsed ||
      amountError
    )
      return
    const value: Intent = {
      operationId: newOperationId(),
      account: address.toLowerCase() as Address,
      chainId: targetChain.id,
      bankAddress: bankAddress.toLowerCase() as Address,
      action,
      amount,
      amountRaw: parsed.toString(),
      phase: "prepared",
    }
    try {
      saveIntent(localStorage, value)
      setIntent(value)
      run(value, true)
    } catch (cause) {
      setStorageError(true)
      setStatus({ message: errorMessage(cause), tone: "error" })
    }
  }
  function stop() {
    execution.current?.abort()
    setStopped(true)
    void queryClient.cancelQueries({ queryKey: balanceKey })
    if (snapshot && address)
      void queryClient.cancelQueries({
        queryKey: [
          "transfers",
          targetChain.id,
          snapshot.token.toLowerCase(),
          address.toLowerCase(),
        ],
      })
    setStatus({ message: "已终止后续请求。已提交的交易不会撤销，稍后可核实原操作。", tone: "info" })
  }

  return (
    <>
      <section
        className="mx-auto w-full max-w-[484px] rounded-[28px] border border-line bg-white p-2.5 shadow-[0_8px_36px_#34212d06] mobile:rounded-3xl mobile:p-2"
        aria-label="Token 存取款"
      >
        <div className="flex items-center justify-between px-2.5 pt-1 pb-3">
          <div className="flex gap-5">
            {(["deposit", "withdraw"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="border-0 bg-transparent px-px pt-2.5 pb-[7px] text-[16px] text-muted aria-pressed:font-[650] aria-pressed:text-heading"
                aria-pressed={action === value}
                disabled={busy || !!intent}
                onClick={() => {
                  setAction(value)
                  setAmount("")
                  setStatus(undefined)
                }}
              >
                {value === "deposit" ? "存入" : "取出"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="银行合约设置"
            disabled={busy}
            onClick={openSettings}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="m9 3 1-1h4l1 3 3 2 3 1v4l-3 2-2 3-1 3h-4l-2-3-3-2-3-1v-4l3-2 2-3Z" />
              <circle cx="12" cy="11" r="3" />
            </svg>
          </button>
        </div>
        <form onSubmit={submit}>
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
                disabled={!snapshot || busy || !!intent}
                aria-invalid={!!amountError}
                aria-describedby="amount-error"
                onChange={(event) => setAmount(event.target.value)}
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
                disabled={!snapshot || busy || !!intent || available === 0n}
                onClick={() => setAmount(formatted(available))}
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
                {deposit ? "Token Bank" : address ? shortAddress(address) : "我的钱包"}
                <span aria-hidden="true"> ↗</span>
              </span>
            </div>
            <p className="text-[14px] wrap-anywhere text-muted">
              {intent
                ? `已保存的${deposit ? "存款" : "取款"}金额 ${intent.amount} ${symbol}`
                : snapshot && !amountError && resultingBalance !== undefined
                  ? `完成后我的银行存款 ${formatted(resultingBalance)} ${symbol}`
                  : "到账金额与输入金额一致"}
            </p>
          </div>
          <p
            id="amount-error"
            className="text-[12px] wrap-anywhere text-[#bc3654] not-empty:px-1 not-empty:py-2.5"
            role={amountError ? "alert" : undefined}
          >
            {amountError}
          </p>
          {!isConnected ? (
            <WalletButton className="primary-button mt-1.5" />
          ) : chainId !== targetChain.id ? (
            <button
              type="button"
              className="primary-button mt-1.5"
              disabled={switchChain.isPending}
              onClick={() => switchChain.mutate({ chainId: targetChain.id })}
            >
              {switchChain.isPending ? "正在切换…" : `切换至 ${targetChain.name}`}
            </button>
          ) : !validBank ? (
            <button type="button" className="primary-button mt-1.5" onClick={openSettings}>
              设置银行合约
            </button>
          ) : (
            <button
              type="submit"
              className="primary-button mt-1.5"
              disabled={
                busy ||
                !!intent ||
                storageError ||
                !snapshot?.idempotent ||
                !parsed ||
                !!amountError
              }
            >
              {busy
                ? "等待钱包确认…"
                : !snapshot
                  ? balance.isError
                    ? "余额暂不可用"
                    : "正在读取余额…"
                  : intent
                    ? "请处理已保存的操作"
                    : !snapshot.idempotent
                      ? "旧版银行仅可查看"
                      : !amount
                        ? "输入金额"
                        : deposit
                          ? "存入 Token"
                          : "取出 Token"}
            </button>
          )}
          {(busy || !stopped) && enabled && (
            <button type="button" className="text-button mt-3" onClick={stop}>
              终止请求
            </button>
          )}
          {intent && (
            <div className="notice info">
              <p className="break-all">操作编号：{intent.operationId}</p>
              <p>
                {intent.action === "deposit" ? "存款" : "取款"} {intent.amount} ·{" "}
                {intent.phase === "confirmed" ? "已确认" : "待核实"}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => run(intent, false)}
                >
                  核实结果
                </button>
                {intent.phase !== "confirmed" && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => run(intent, true)}
                  >
                    使用原操作继续
                  </button>
                )}
                {intent.phase === "confirmed" && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      localStorage.removeItem(
                        intentKey(intent.account, intent.chainId, intent.bankAddress)
                      )
                      setIntent(undefined)
                      setAmount("")
                      setStatus(undefined)
                      setStopped(false)
                    }}
                  >
                    新的一笔
                  </button>
                )}
              </div>
            </div>
          )}
          {stopped && !intent && (
            <button type="button" className="text-button" onClick={() => setStopped(false)}>
              恢复查询
            </button>
          )}
          {switchChain.error && (
            <p className="notice error" role="alert">
              网络未切换。{errorMessage(switchChain.error)}
            </p>
          )}
          {isConnected && chainId !== targetChain.id && (
            <p className="notice info" role="status">
              当前钱包网络 ID：{chainId}，需要 {targetChain.name}（{targetChain.id}）。
              请确认钱包中当前网站的连接网络；资产列表的网络筛选不会切换网站网络。
            </p>
          )}
          {enabled && balance.error && (
            <div className="notice error" role="alert">
              余额读取失败，请检查银行地址及网络。
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setStopped(false)
                  errors.recover(
                    queryClient.getQueryCache().find({ queryKey: balanceKey })?.queryHash ?? ""
                  )
                  void balance.refetch()
                }}
              >
                重新读取
              </button>
            </div>
          )}
          {status && (
            <div className={`notice ${status.tone}`} role="status">
              <p>{status.message}</p>
              {status.hash && (
                <a
                  href={explorerLink("tx", status.hash)}
                  title={status.hash}
                  target="_blank"
                  rel="noreferrer"
                >
                  {explorerLink("tx", status.hash) ? "查看交易 ↗" : shortAddress(status.hash)}
                </a>
              )}
            </div>
          )}
        </form>
        <p className="px-1 pt-3.5 pb-1.5 text-center text-[11px] text-[#827787]">
          {deposit
            ? "授权不足时，仅授权本次金额，再确认存款。"
            : "取出后，Token 将转回当前连接的钱包。"}
        </p>
      </section>
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
      <TransferHistory account={address} snapshot={snapshot} stopped={stopped} />
      <dialog ref={settings} className="modal" aria-labelledby="settings-title">
        <div className="flex items-center justify-between gap-4 [&_p]:mt-[7px] mobile:[&_h2]:text-[17px]">
          <h2 id="settings-title">银行合约设置</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭设置"
            onClick={() => settings.current?.close()}
          >
            ×
          </button>
        </div>
        <p className="my-3.5 text-[13px] leading-[1.8] text-muted">
          填写 {targetChain.name} 上的 TokenBank 地址。代币信息将从合约自动读取。
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const value = draft.trim()
            if (!isAddress(value) || value === zeroAddress) {
              setSettingsError("请输入有效的银行合约地址")
              return
            }
            settings.current?.close()
            onBankChange(value)
          }}
        >
          <label className="mt-5 mb-2 block text-[13px]" htmlFor="bank-address">
            银行合约地址
          </label>
          <input
            className="w-full rounded-xl border border-[#e7e0ea] bg-[#fcfafc] p-3.5 text-[13px]"
            id="bank-address"
            placeholder="0x…"
            value={draft}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={!!settingsError}
            aria-describedby="settings-error"
          />
          <p className="mt-2.5 text-[12px] leading-[1.8] text-muted">
            请使用 TokenBank 地址，NFTMarket 和 Token 地址无法用于存取款。
          </p>
          <p
            id="settings-error"
            className="text-[12px] wrap-anywhere text-[#bc3654] not-empty:px-1 not-empty:py-2.5"
            role={settingsError ? "alert" : undefined}
          >
            {settingsError}
          </p>
          <button className="primary-button mt-4" type="submit">
            保存合约
          </button>
        </form>
      </dialog>
    </>
  )
}

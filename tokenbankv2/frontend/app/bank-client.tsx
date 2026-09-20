"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import { createBank, errorMessage, parseAmount, shortAddress } from "@/lib/bank"
import { explorerLink, targetChain, wagmiConfig } from "@/lib/wagmi"
import { TransferHistory } from "./transfer-history"
import { WalletButton } from "./wallet-button"

export function BankClient() {
  const connection = useConnection()
  const [bankAddress, setBankAddress] = useState(
    process.env.NEXT_PUBLIC_BANK_ADDRESS ?? ""
  )
  // 会话切换时重建工作区，金额、历史分页和旧交易提示不串到新账户。
  const sessionKey = `${connection.address}:${connection.chainId}:${connection.connector?.uid}:${bankAddress}`
  return (
    <>
      <header className="site-header">
        <a href="#bank" className="brand" aria-label="Token Bank 首页">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>
          <span>Token Bank</span>
        </a>
        <nav aria-label="主导航">
          <a className="active" href="#bank">
            存取
          </a>
          <a href="#activity">记录</a>
        </nav>
        <div className="header-actions">
          <span className="network-badge">
            <span className="network-dot" />
            {connection.isConnected
              ? (connection.chain?.name ?? `网络 ${connection.chainId}`)
              : "未连接"}
          </span>
          <WalletButton />
        </div>
      </header>
      <main id="bank">
        <div className="hero-heading">
          <p className="eyebrow">YOUR TOKENS. YOUR CONTROL.</p>
          <h1>
            你的资产，<span>随存随取。</span>
          </h1>
          <p className="muted">从钱包到银行，每一笔都由你掌控。</p>
        </div>
        <BankWorkspace
          key={sessionKey}
          bankAddress={bankAddress}
          onBankChange={setBankAddress}
        />
      </main>
      <footer className="site-footer">
        <a href="#bank" className="muted">
          Token Bank
        </a>
        <span className="small muted">
          {targetChain.name} · 链上余额，随时可查
        </span>
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
  const [busy, setBusy] = useState(false)
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
    }
  }, [])
  const validBank = isAddress(bankAddress) && bankAddress !== zeroAddress
  const enabled = isConnected && chainId === targetChain.id && validBank

  async function bank() {
    if (!address || !connector || !validBank)
      throw new Error("请先连接钱包并配置银行合约")
    const provider = (await connector.getProvider()) as EIP1193Provider
    return createBank(
      provider,
      targetChain.id,
      bankAddress as Address,
      address,
      () => {
        const current = getConnection(wagmiConfig)
        return (
          active.current &&
          current.address === address &&
          current.chainId === targetChain.id &&
          current.connector?.uid === connector.uid
        )
      }
    )
  }

  const balance = useQuery({
    queryKey: ["balance", targetChain.id, bankAddress, address, connector?.uid],
    enabled,
    queryFn: async () => (await bank()).read(),
    refetchInterval: busy ? false : 15_000,
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
  const formatted = (value: bigint) =>
    formatUnits(value, snapshot?.decimals ?? 18)
  const resultingBalance = snapshot
    ? snapshot.deposited + (deposit ? parsed : -parsed)
    : undefined

  function openSettings() {
    setDraft(bankAddress)
    setSettingsError("")
    settings.current?.showModal()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked.current || !snapshot || !parsed || amountError) return
    locked.current = true
    setBusy(true)
    setStatus({ message: "正在检查余额和授权…", tone: "info" })
    try {
      const hash = await (await bank()).transact(
        action,
        amount,
        (message, hash) => {
          if (active.current)
            setStatus((previous) => ({
              message,
              tone: "info",
              hash: hash ?? previous?.hash,
            }))
        }
      )
      // 余额来自链上回执后的重新读取；记录由索引器独立同步，不能伪造成功行。
      await queryClient.invalidateQueries({ queryKey: ["balance"] })
      void queryClient.invalidateQueries({ queryKey: ["transfers"] })
      if (active.current) {
        setAmount("")
        setStatus({
          message: `${deposit ? "存款" : "取款"}已确认。转账记录将在索引完成后显示。`,
          tone: "success",
          hash,
        })
      }
    } catch (cause) {
      if (active.current)
        setStatus((previous) => ({
          ...previous,
          message: errorMessage(cause),
          tone: "error",
        }))
    } finally {
      locked.current = false
      if (active.current) setBusy(false)
    }
  }

  return (
    <>
      <section className="bank-card" aria-label="Token 存取款">
        <div className="card-toolbar">
          <div className="action-tabs">
            {(["deposit", "withdraw"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={action === value}
                disabled={busy}
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
          <div className="amount-panel">
            <label htmlFor="amount" className="muted">
              {deposit ? "从钱包存入" : "从银行取出"}
            </label>
            <div className="amount-row">
              <input
                id="amount"
                name="amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                disabled={!snapshot || busy}
                aria-invalid={!!amountError}
                aria-describedby="amount-error"
                onChange={(event) => setAmount(event.target.value)}
              />
              <span className="token-pill">
                <span className="token-mark" aria-hidden="true">
                  T
                </span>
                {symbol}
              </span>
            </div>
            <div className="amount-bottom">
              <span className="small muted balance-value">
                {deposit ? "钱包余额" : "可提余额"}{" "}
                {snapshot ? formatted(available) : "—"}
              </span>
              <button
                type="button"
                className="max-button"
                disabled={!snapshot || busy || available === 0n}
                onClick={() => setAmount(formatted(available))}
              >
                全部
              </button>
            </div>
          </div>
          <div className="direction-separator" aria-hidden="true">
            ↓
          </div>
          <div className="receive-panel">
            <span className="muted">{deposit ? "存入银行" : "返回钱包"}</span>
            <div className="receive-row">
              <span
                className={`receive-amount ${!parsed ? "placeholder" : ""}`}
              >
                {parsed ? formatted(parsed) : "0"}
              </span>
              <span className="destination">
                {deposit
                  ? "Token Bank"
                  : address
                    ? shortAddress(address)
                    : "我的钱包"}
                <span aria-hidden="true"> ↗</span>
              </span>
            </div>
            <p className="small muted">
              {snapshot && !amountError && resultingBalance !== undefined
                ? `完成后我的银行存款 ${formatted(resultingBalance)} ${symbol}`
                : "到账金额与输入金额一致"}
            </p>
          </div>
          <p
            id="amount-error"
            className="amount-error"
            role={amountError ? "alert" : undefined}
          >
            {amountError}
          </p>
          {!isConnected ? (
            <WalletButton className="primary-button" />
          ) : chainId !== targetChain.id ? (
            <button
              type="button"
              className="primary-button"
              disabled={switchChain.isPending}
              onClick={() => switchChain.mutate({ chainId: targetChain.id })}
            >
              {switchChain.isPending
                ? "正在切换…"
                : `切换至 ${targetChain.name}`}
            </button>
          ) : !validBank ? (
            <button
              type="button"
              className="primary-button"
              onClick={openSettings}
            >
              设置银行合约
            </button>
          ) : (
            <button
              type="submit"
              className="primary-button"
              disabled={busy || !snapshot || !parsed || !!amountError}
            >
              {busy
                ? "等待钱包确认…"
                : !snapshot
                  ? balance.isError
                    ? "余额暂不可用"
                    : "正在读取余额…"
                  : !amount
                    ? "输入金额"
                    : deposit
                      ? "存入 Token"
                      : "取出 Token"}
            </button>
          )}
          {switchChain.error && (
            <p className="notice error" role="alert">
              网络未切换。{errorMessage(switchChain.error)}
            </p>
          )}
          {isConnected && chainId !== targetChain.id && (
            <p className="notice info" role="status">
              当前钱包网络 ID：{chainId}，需要 {targetChain.name}（
              {targetChain.id}）。
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
                  {explorerLink("tx", status.hash)
                    ? "查看交易 ↗"
                    : shortAddress(status.hash)}
                </a>
              )}
            </div>
          )}
        </form>
        <p className="transaction-note">
          {deposit
            ? "授权不足时，仅授权本次金额，再确认存款。"
            : "取出后，Token 将转回当前连接的钱包。"}
        </p>
      </section>
      <section className="balance-summary" aria-label="钱包与银行资产">
        <div>
          <span className="small muted">我的钱包余额</span>
          <p data-testid="wallet-balance">
            {snapshot ? formatted(snapshot.walletBalance) : "—"}
            <span className="small muted"> {snapshot ? symbol : ""}</span>
          </p>
        </div>
        <div>
          <span className="small muted">我的银行存款</span>
          <p data-testid="bank-balance">
            {snapshot ? formatted(snapshot.deposited) : "—"}
            <span className="small muted"> {snapshot ? symbol : ""}</span>
          </p>
        </div>
        <div>
          <span className="small muted">银行总资产</span>
          <p data-testid="bank-assets">
            {snapshot ? formatted(snapshot.bankAssets) : "—"}
            <span className="small muted"> {snapshot ? symbol : ""}</span>
          </p>
        </div>
      </section>
      <p className="transaction-note">
        银行总资产为该合约持有的代币总量；你只能取出自己的银行存款。
      </p>
      <div className="contract-details small muted">
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
      <TransferHistory account={address} snapshot={snapshot} />
      <dialog ref={settings} className="modal" aria-labelledby="settings-title">
        <div className="section-heading">
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
        <p className="muted">
          填写 {targetChain.name} 上的 TokenBank
          地址。代币信息将从合约自动读取。
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
          <label className="field-label" htmlFor="bank-address">
            银行合约地址
          </label>
          <input
            className="address-input"
            id="bank-address"
            placeholder="0x…"
            value={draft}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={!!settingsError}
            aria-describedby="settings-error"
          />
          <p className="small muted">
            请使用 TokenBank 地址，NFTMarket 和 Token 地址无法用于存取款。
          </p>
          <p
            id="settings-error"
            className="amount-error"
            role={settingsError ? "alert" : undefined}
          >
            {settingsError}
          </p>
          <button className="primary-button" type="submit">
            保存合约
          </button>
        </form>
      </dialog>
    </>
  )
}

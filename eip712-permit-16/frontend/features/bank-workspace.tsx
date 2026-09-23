import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type JSX, type SubmitEvent, useEffect, useRef, useState } from "react"
import { type Address, type EIP1193Provider, type Hash, isAddress, zeroAddress } from "viem"
import { useConnection, useSwitchChain } from "wagmi"
import { getConnection } from "wagmi/actions"
import { AmountFields } from "@/domains/bank/amount-fields"
import { BankBalances } from "@/domains/bank/bank-balances"
import { BankSettingsDialog } from "@/domains/bank/bank-settings-dialog"
import { type Authorization, createBank, parseAmount } from "@/domains/bank/client"
import {
  clearConfirmedIntent,
  executeIntent,
  type Intent,
  newOperationId,
  restoreIntent,
  saveIntent,
} from "@/domains/operations/client"
import { OperationNotice } from "@/domains/operations/operation-notice"
import { TransferHistory } from "@/domains/transfers/transfer-history"
import { explorerLink, targetChain, wagmiConfig } from "@/domains/wallet/config"
import { WalletButton } from "@/domains/wallet/wallet-button"
import { errors } from "@/shared/error-queue"
import { asAppError } from "@/shared/errors"
import { errorMessage, shortAddress } from "@/shared/web3"

/**
 * 当前钱包会话的流程入口：余额查询 → 金额校验 → 保存意图 → executeIntent → 刷新余额与记录。
 * 金额、操作和终止状态由这里持有；领域组件通过属性展示，通过回调把操作交回这里。
 */
export function BankWorkspace({
  bankAddress,
  onBankChange,
}: {
  bankAddress: string
  onBankChange: (address: string) => void
}): JSX.Element {
  const { address, chainId, connector, isConnected } = useConnection()
  const switchChain = useSwitchChain()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<"deposit" | "withdraw">("deposit")
  const [amount, setAmount] = useState("")
  const [authorization, setAuthorization] = useState<Authorization>("permit")
  const [intent, setIntent] = useState<Intent>()
  // stopped 控制查询是否可自动启动；mutation.isPending 只表示这次提交是否仍在执行。
  const [stopped, setStopped] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const execution = useRef<AbortController | null>(null)
  const [status, setStatus] = useState<{
    message: string
    tone: string
    hash?: Hash
  }>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // active 拦住旧工作区的异步回调；locked 同步拦住 React 更新按钮状态前的连续点击。
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
  // 刷新或切换回此账户时只恢复记录，由用户选择核实或继续，不能自动另建一笔。
  useEffect(() => {
    if (!address || !isAddress(bankAddress)) return
    try {
      const saved = restoreIntent(localStorage, address, targetChain.id, bankAddress)
      if (saved) {
        setIntent(saved)
        setAction(saved.action)
        setAuthorization(saved.authorization ?? "approve")
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
          // 钱包可能在工作区卸载后才返回哈希：仍保存到原账户的记录，但不更新旧界面。
          saveIntent(localStorage, saved)
          if (active.current) setIntent(saved)
        },
        progress: (message) => {
          if (active.current && !controller.signal.aborted) setStatus({ message, tone: "info" })
        },
      })
    },
    onSuccess: (saved) => {
      // executeIntent 成功表示后端已核实业务；Transfer 索引可能尚未追上，分别刷新两类数据。
      if (!isCurrent() || execution.current?.signal.aborted) return
      // 完成的意图退出恢复流程，表单准备好下一笔；新编号仍只在用户再次提交时生成。
      clearConfirmedIntent(localStorage, saved)
      setIntent(undefined)
      setAmount("")
      setStopped(false)
      setStatus({
        message: `${saved.action === "deposit" ? "存入" : "取出"}成功：${saved.amount} ${snapshot?.symbol ?? "Token"}。`,
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
  // 账户、网络、银行和连接共同隔离余额缓存；读取失败时不把旧快照作为当前可用余额。
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
  const deposit = action === "deposit"
  const depositAuthorization =
    intent?.authorization ??
    ((authorization === "permit" && !snapshot?.permitSupported) ||
    (authorization === "permit2" && !snapshot?.permit2)
      ? "approve"
      : authorization)

  let submitLabel = deposit
    ? depositAuthorization !== "approve"
      ? "签名并存入"
      : "存入 Token"
    : "取出 Token"
  if (busy) submitLabel = "等待钱包确认…"
  else if (!snapshot) submitLabel = balance.isError ? "余额暂不可用" : "正在读取余额…"
  else if (intent) submitLabel = "请处理已保存的操作"
  else if (!snapshot.idempotent) submitLabel = "旧版银行仅可查看"
  else if (!amount) submitLabel = "输入金额"

  function openSettings() {
    setSettingsOpen(true)
  }

  // send=false 只核实结果；true 允许继续原操作的授权/业务步骤，两者都沿用 value.operationId。
  function run(value: Intent, send: boolean) {
    if (locked.current) return
    locked.current = true
    execution.current = new AbortController()
    // 用户明确继续才开启新的执行上下文；自动轮询仍等待本次成功后恢复。
    mutation.mutate({ value, send })
  }
  function submit(event: SubmitEvent<HTMLFormElement>) {
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
      authorization: deposit ? depositAuthorization : undefined,
      amount,
      amountRaw: parsed.toString(),
      phase: "prepared",
    }
    try {
      // 先落盘再登录/请求钱包，响应丢失或刷新后才能用同一编号恢复；保存失败则禁止提交。
      saveIntent(localStorage, value)
      setIntent(value)
      run(value, true)
    } catch (cause) {
      setStorageError(true)
      setStatus({ message: errorMessage(cause), tone: "error" })
    }
  }
  function stop() {
    // 终止本次写入流程，并取消本工作区的读请求；stopped 继续阻止轮询、聚焦和重连触发查询。
    // 这不会撤销已广播交易，也不能关闭钱包弹窗；晚返回的哈希仍由 persist 保存。
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
        className="mx-auto w-full max-w-[480px] rounded-[28px] border border-line bg-white p-2.5 shadow-[0_6px_32px_#34212d08] mobile:rounded-3xl mobile:p-2"
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
          {deposit && (
            <fieldset disabled={busy || !!intent} className="mb-3 px-2">
              <legend className="sr-only">存款授权方式</legend>
              <div className="flex gap-2 rounded-2xl bg-[#f6f5f7] p-1">
                {(["approve", "permit", "permit2"] as const).map((mode) => (
                  <label key={mode} className="flex-1">
                    <input
                      type="radio"
                      name="authorization"
                      value={mode}
                      className="peer sr-only"
                      checked={depositAuthorization === mode}
                      disabled={
                        (mode === "permit" && !snapshot?.permitSupported) ||
                        (mode === "permit2" && !snapshot?.permit2)
                      }
                      onChange={() => {
                        setAuthorization(mode)
                        setStatus(undefined)
                      }}
                    />
                    <span className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-[13px] text-muted peer-checked:bg-white peer-checked:font-semibold peer-checked:text-heading peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-40">
                      {mode === "approve" ? "普通授权" : mode === "permit" ? "Permit" : "Permit2"}
                    </span>
                  </label>
                ))}
              </div>
              {snapshot && !snapshot.permitSupported && (
                <p className="mt-2 px-1 text-[11px] text-muted">
                  当前 Token 或银行不支持 EIP-2612，可选择其他可用方式。
                </p>
              )}
            </fieldset>
          )}
          <AmountFields
            action={action}
            amount={amount}
            onAmountChange={(value) => {
              setAmount(value)
              setStatus(undefined)
            }}
            account={address}
            snapshot={snapshot}
            available={available}
            parsed={parsed}
            amountError={amountError}
            disabled={busy || !!intent}
            savedAmount={intent?.amount}
          />
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
              {submitLabel}
            </button>
          )}
          {(busy || !stopped) && enabled && (
            <button type="button" className="text-button mt-3" onClick={stop}>
              终止请求
            </button>
          )}
          {intent && !busy && (
            <OperationNotice
              intent={intent}
              busy={busy}
              onVerify={() => run(intent, false)}
              onContinue={() => run(intent, true)}
            />
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
            ? depositAuthorization === "permit"
              ? "先签署本次额度（20 分钟有效），再确认存款交易。"
              : depositAuthorization === "permit2"
                ? "先检查 Permit2 额度，不足时授权本次金额；再签名并存入。已有额度时只需一笔交易。"
                : "授权不足时，仅授权本次金额，再确认存款。"
            : "取出后，Token 将转回当前连接的钱包。"}
        </p>
      </section>
      <BankBalances bankAddress={bankAddress} snapshot={snapshot} />
      <TransferHistory account={address} snapshot={snapshot} stopped={stopped} />
      {settingsOpen && (
        <BankSettingsDialog
          bankAddress={bankAddress}
          onBankChange={onBankChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  )
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type JSX, type SubmitEvent, useEffect, useRef, useState } from "react"
import { type Address, type EIP1193Provider, type Hash, isAddress, zeroAddress } from "viem"
import { useConnection, useSwitchChain } from "wagmi"
import { getConnection } from "wagmi/actions"
import { AmountFields } from "@/domains/bank/amount-fields"
import { BankBalances } from "@/domains/bank/bank-balances"
import { BankSettingsDialog } from "@/domains/bank/bank-settings-dialog"
import { createBank, parseAmount } from "@/domains/bank/client"
import {
  executeIntent,
  type Intent,
  intentKey,
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
  const [intent, setIntent] = useState<Intent>()
  const [stopped, setStopped] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const execution = useRef<AbortController | null>(null)
  const [status, setStatus] = useState<{
    message: string
    tone: string
    hash?: Hash
  }>()
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const deposit = action === "deposit"

  let submitLabel = deposit ? "存入 Token" : "取出 Token"
  if (busy) submitLabel = "等待钱包确认…"
  else if (!snapshot) submitLabel = balance.isError ? "余额暂不可用" : "正在读取余额…"
  else if (intent) submitLabel = "请处理已保存的操作"
  else if (!snapshot.idempotent) submitLabel = "旧版银行仅可查看"
  else if (!amount) submitLabel = "输入金额"

  function openSettings() {
    setSettingsOpen(true)
  }

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
          <AmountFields
            action={action}
            amount={amount}
            onAmountChange={setAmount}
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
          {intent && (
            <OperationNotice
              intent={intent}
              busy={busy}
              onVerify={() => run(intent, false)}
              onContinue={() => run(intent, true)}
              onNewOperation={() => {
                localStorage.removeItem(
                  intentKey(intent.account, intent.chainId, intent.bankAddress)
                )
                setIntent(undefined)
                setAmount("")
                setStatus(undefined)
                setStopped(false)
              }}
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
            ? "授权不足时，仅授权本次金额，再确认存款。"
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

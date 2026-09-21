import {
  type Address,
  bytesToHex,
  createWalletClient,
  custom,
  type EIP1193Provider,
  type Hash,
  isAddress,
  maxUint256,
} from "viem"
import { createSiweMessage } from "viem/siwe"
import { AppError, asAppError } from "../../shared/errors.ts"
import { request } from "../../shared/request.ts"
import { createBank } from "../bank/client.ts"

export type Intent = {
  operationId: Hash
  account: Address
  chainId: number
  bankAddress: Address
  action: "deposit" | "withdraw"
  amount: string
  amountRaw: string
  phase: "prepared" | "approval" | "business" | "unknown" | "confirmed"
  approvalHash?: Hash
  businessHash?: Hash
}
export const intentKey = (account: string, chainId: number, bank: string) =>
  `tokenbank:operation:${chainId}:${bank.toLowerCase()}:${account.toLowerCase()}`
export const newOperationId = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
const isHash = (value: unknown): value is Hash =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value)
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("服务端返回无效数据")
  return value as Record<string, unknown>
}
export function restoreIntent(
  storage: Pick<Storage, "getItem">,
  account: Address,
  chainId: number,
  bank: Address
): Intent | undefined {
  const raw = storage.getItem(intentKey(account, chainId, bank))
  if (!raw) return undefined
  const data = record(JSON.parse(raw))
  if (
    !isHash(data.operationId) ||
    data.account !== account.toLowerCase() ||
    data.chainId !== chainId ||
    data.bankAddress !== bank.toLowerCase() ||
    (data.action !== "deposit" && data.action !== "withdraw") ||
    typeof data.amount !== "string" ||
    !/^\d+(\.\d+)?$/.test(data.amount) ||
    typeof data.amountRaw !== "string" ||
    !/^[1-9][0-9]{0,77}$/.test(data.amountRaw) ||
    BigInt(data.amountRaw) > maxUint256 ||
    typeof data.phase !== "string" ||
    !["prepared", "approval", "business", "unknown", "confirmed"].includes(data.phase) ||
    (data.approvalHash !== undefined && !isHash(data.approvalHash)) ||
    (data.businessHash !== undefined && !isHash(data.businessHash))
  )
    throw new Error("本地操作记录无效，请保留记录并核对钱包，暂不创建新操作")
  return data as Intent
}
export function saveIntent(storage: Pick<Storage, "setItem">, intent: Intent) {
  storage.setItem(
    intentKey(intent.account, intent.chainId, intent.bankAddress),
    JSON.stringify(intent)
  )
}
async function authenticate(provider: EIP1193Provider, intent: Intent, signal: AbortSignal) {
  const parseSession = (data: unknown) => {
    const value = record(data)
    if (
      typeof value.address !== "string" ||
      !isAddress(value.address) ||
      !Number.isSafeInteger(value.chainId)
    )
      throw new Error("登录响应无效")
    return value
  }
  const current = await request("/api/backend/auth/session", { signal, parse: parseSession }).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.code === "AUTH_REQUIRED") return undefined
      throw error
    }
  )
  if (current?.address === intent.account && current.chainId === intent.chainId) return
  const challenge = await request("/api/backend/auth/challenge", {
    method: "POST",
    body: { address: intent.account },
    signal,
    parse: (data) => {
      const value = record(data)
      if (
        typeof value.nonce !== "string" ||
        !/^[a-zA-Z0-9]{8,}$/.test(value.nonce) ||
        value.domain !== location.host ||
        value.uri !== location.origin ||
        value.chainId !== intent.chainId
      )
        throw new Error("登录请求来源或网络不匹配")
      return { nonce: value.nonce, domain: location.host, uri: location.origin }
    },
  })
  signal.throwIfAborted()
  const message = createSiweMessage({
    ...challenge,
    address: intent.account,
    chainId: intent.chainId,
    version: "1",
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + 240_000),
    statement: "登录 Token Bank，仅验证身份，不发送交易。",
  })
  const wallet = createWalletClient({ transport: custom(provider, { retryCount: 0 }) })
  const signature = await wallet.signMessage({ account: intent.account, message })
  signal.throwIfAborted()
  const session = await request("/api/backend/auth/verify", {
    method: "POST",
    body: { message, signature },
    signal,
    parse: parseSession,
  })
  if (session.address !== intent.account || session.chainId !== intent.chainId)
    throw new Error("钱包登录身份不匹配")
}
function parseOperation(data: unknown, intent: Intent) {
  const value = record(data)
  for (const key of [
    "operationId",
    "account",
    "chainId",
    "bankAddress",
    "action",
    "amountRaw",
  ] as const) {
    if (value[key] !== intent[key]) throw new Error("服务端操作与本次操作不匹配")
  }
  if (
    value.status !== undefined &&
    value.status !== "confirmed" &&
    value.status !== "pending" &&
    value.status !== "failed"
  )
    throw new Error("操作状态无效")
  if (
    value.transactionHash !== undefined &&
    value.transactionHash !== null &&
    !isHash(value.transactionHash)
  )
    throw new Error("操作交易哈希无效")
  return {
    status: value.status,
    transactionHash: isHash(value.transactionHash) ? value.transactionHash : undefined,
  }
}

// persist 在钱包返回后先执行，即使页面已终止，也不能丢失晚返回的交易哈希。
export async function executeIntent(
  intent: Intent,
  options: {
    provider: EIP1193Provider
    signal: AbortSignal
    isCurrent: () => boolean
    persist: (intent: Intent) => void
    progress: (message: string) => void
    send: boolean
  }
) {
  const { provider, signal, isCurrent, persist, progress } = options
  let current = { ...intent }
  const save = (patch: Partial<Intent>) => {
    current = { ...current, ...patch }
    persist(current)
  }
  const check = () => {
    signal.throwIfAborted()
    if (!isCurrent()) throw new DOMException("钱包会话已变化", "AbortError")
  }
  const api = `/api/backend/operations/${intent.operationId}`
  const parse = (data: unknown) => parseOperation(data, intent)
  const inspect = () => request(api, { signal, parse })
  const register = (hash: Hash) =>
    request(`${api}/transactions`, {
      method: "POST",
      body: { transactionHash: hash },
      signal,
      parse: (data) => {
        if (record(data).recorded !== true) throw new Error("交易记录保存失败")
      },
    })
  try {
    check()
    progress("请确认钱包登录，正在恢复操作记录…")
    await authenticate(provider, intent, signal)
    check()
    await request("/api/backend/operations", {
      method: "POST",
      headers: { "Idempotency-Key": intent.operationId },
      body: intent,
      signal,
      parse,
    })
    check()
    if (current.businessHash) await register(current.businessHash)
    let result = await inspect()
    check()
    if (result.status !== "confirmed" && options.send) {
      // 已广播且未知时只等待原交易；已核实回滚才允许同编号重试。
      if (result.status === "failed") save({ businessHash: undefined })
      const bank = createBank(
        provider,
        intent.chainId,
        intent.bankAddress,
        intent.account,
        isCurrent,
        signal
      )
      await bank.transact(intent.action, intent.amount, progress, {
        id: intent.operationId,
        expectedAmount: intent.amountRaw,
        approvalHash: current.approvalHash,
        businessHash: current.businessHash,
        onBroadcast: (stage, hash) =>
          save(
            stage === "approval"
              ? { phase: "approval", approvalHash: hash }
              : { phase: "business", businessHash: hash }
          ),
      })
      check()
      if (current.businessHash) await register(current.businessHash)
      result = await inspect()
      check()
    }
    if (result.status === "confirmed") {
      save({ phase: "confirmed", businessHash: result.transactionHash })
      progress("业务已确认。转账记录将在索引完成后显示。")
      return current
    }
    save({ phase: "unknown" })
    throw new AppError(
      "business",
      "RESULT_UNKNOWN",
      result.status === "failed"
        ? "交易已回滚，可使用原操作继续"
        : "结果待核实。可再次核实，或使用原操作继续",
      { severity: 2 }
    )
  } catch (cause) {
    // 即使操作之前曾确认，也要保留本次核实发现的未知状态（例如链重组）。
    save({ phase: "unknown" })
    const error = asAppError(signal.aborted ? signal.reason : cause)
    if (error.code === "TRANSACTION_REVERTED" && !current.businessHash)
      save({ approvalHash: undefined })
    if (error.kind !== "cancelled" && current.businessHash)
      throw new AppError("business", "RESULT_UNKNOWN", "交易结果待核实，请保留原操作并再次查看", {
        severity: 2,
      })
    throw error
  }
}

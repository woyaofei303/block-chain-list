import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  createWalletClient,
  custom,
  type EIP1193Provider,
  encodeFunctionData,
  erc20Abi,
  type Hash,
  isAddress,
  maxUint256,
  numberToHex,
  parseAbi,
  parseSignature,
  parseUnits,
  TransactionReceiptNotFoundError,
  zeroAddress,
  zeroHash,
} from "viem"

import { AppError } from "../../shared/errors.ts"
import { wait } from "../../shared/request.ts"

export const METAMASK_DELEGATOR = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B"
const delegationCode = `0xef0100${METAMASK_DELEGATOR.slice(2).toLowerCase()}`

const bankAbi = parseAbi([
  "function token() view returns (address)",
  "function permit2() view returns (address)",
  "function depositWithPermit2(uint256 amount,bytes32 operationId,uint256 deadline,bytes signature)",
  "function supportsPermit() view returns (bool)",
  "function permitDeposit(uint256 amount,bytes32 operationId,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function operationHash(address, bytes32) view returns (bytes32)",
  "function balances(address) view returns (uint256)",
  "function deposit(uint256 amount, bytes32 operationId)",
  "function withdraw(uint256 amount, bytes32 operationId)",
])

const permitAbi = parseAbi([
  "function nonces(address) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
])
const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const
const permit2Types = {
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const

export type Authorization = "approve" | "permit" | "permit2"
// 只将合约不支持接口视为不可用；RPC 故障必须交给原错误处理流程。
function unsupported(error: unknown): false {
  if (
    error instanceof BaseError &&
    error.walk(
      (cause) =>
        cause instanceof ContractFunctionRevertedError ||
        cause instanceof ContractFunctionZeroDataError
    )
  )
    return false
  throw error
}

/** 展示文本转为合约最小单位；先检查精度，避免 parseUnits 舍入后改变用户输入的金额。 */
export function parseAmount(text: string, decimals: number, available: bigint) {
  const value = text.trim()
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("请输入有效的正数金额")
  if ((value.split(".")[1]?.length ?? 0) > decimals) {
    throw new Error(`最多支持 ${decimals} 位小数`)
  }
  const amount = parseUnits(value, decimals)
  if (amount <= 0n) throw new Error("金额必须大于 0")
  if (amount > maxUint256) throw new Error("金额超出合约支持范围")
  if (amount > available) throw new Error("金额超过可用余额")
  return amount
}

export type Snapshot = {
  token: Address
  symbol: string
  decimals: number
  walletBalance: bigint
  deposited: bigint
  bankAssets: bigint
  idempotent: boolean
  permitSupported: boolean
  permit2?: Address
}

/** 钱包 RPC 边界：读取快照、模拟、签名与等待回执；HTTP 会话和最终业务核实见 operations/client.ts。 */
export function createBank(
  provider: EIP1193Provider,
  chainId: number,
  bank: Address,
  account: Address,
  isCurrent: () => boolean = () => true,
  signal?: AbortSignal
) {
  if (!isAddress(bank) || bank === zeroAddress) throw new Error("请输入有效的银行合约地址")
  const check = () => signal?.throwIfAborted()
  // 扩展钱包的 RPC 不经过 shared/request 的 HTTP 队列；取消后丢弃读结果并阻止后续步骤。
  const transport = custom(
    {
      request: async (args) => {
        check()
        const result = await provider.request(args)
        check()
        return result
      },
    },
    { retryCount: 0 }
  )
  const client = createPublicClient({ transport, pollingInterval: 1_000 })
  // 钱包晚返回的哈希必须先保存，不能被读请求的取消包装丢弃。
  const wallet = createWalletClient({ transport: custom(provider, { retryCount: 0 }) })

  // 每次读取及签名前复核账户和网络，阻止旧会话继续发起交易。
  async function assertSession() {
    check()
    const [network, accounts] = await Promise.all([client.getChainId(), wallet.getAddresses()])
    check()
    if (!isCurrent() || accounts[0]?.toLowerCase() !== account.toLowerCase()) {
      throw new Error("钱包账户已变化，请重新操作")
    }
    if (network !== chainId) throw new Error("钱包网络不匹配，请切换网络")
  }

  async function read(): Promise<Snapshot> {
    await assertSession()
    const token = await client.readContract({
      address: bank,
      abi: bankAbi,
      functionName: "token",
    })
    const [symbol, decimals, walletBalance, deposited, bankAssets] = await Promise.all([
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      }),
      client.readContract({
        address: bank,
        abi: bankAbi,
        functionName: "balances",
        args: [account],
      }),
      // 合约实际持币量供所有账户共同查看，不作为个人可提额度。
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [bank],
      }),
    ])
    // 探测新版幂等接口；旧银行仍可读，连接故障则继续抛出，不能误判成“不支持幂等”。
    const idempotent = await client
      .readContract({
        address: bank,
        abi: bankAbi,
        functionName: "operationHash",
        args: [account, zeroHash],
      })
      .then(() => true, unsupported)
    const permitSupported =
      idempotent &&
      (await (async () => {
        if (
          !(await client.readContract({
            address: bank,
            abi: bankAbi,
            functionName: "supportsPermit",
          }))
        )
          return false
        await Promise.all([
          client.readContract({
            address: token,
            abi: permitAbi,
            functionName: "nonces",
            args: [account],
          }),
          client.readContract({ address: token, abi: permitAbi, functionName: "DOMAIN_SEPARATOR" }),
        ])
        return true
      })().catch(unsupported))
    const permit2 = await client
      .readContract({ address: bank, abi: bankAbi, functionName: "permit2" })
      .catch(unsupported)
    await assertSession()
    return {
      token,
      symbol,
      decimals,
      walletBalance,
      deposited,
      bankAssets,
      idempotent,
      permitSupported,
      permit2: idempotent && permit2 && permit2 !== zeroAddress ? permit2 : undefined,
    }
  }

  async function batchCapability() {
    await assertSession()
    const capabilities = await wallet.getCapabilities({ account, chainId })
    const status = capabilities?.atomic?.status
    if (status !== "supported" && status !== "ready")
      throw new Error("当前钱包或网络不支持原子批量交易，请使用支持 EIP-7702 的 MetaMask 网络")
    const [code, implementation] = await Promise.all([
      client.getCode({ address: account }),
      client.getCode({ address: METAMASK_DELEGATOR }),
    ])
    if (code && code !== "0x" && code.toLowerCase() !== delegationCode)
      throw new Error("当前账户未委托给题目指定的 MetaMask Delegator，请先在钱包中核对")
    if (!implementation || implementation === "0x")
      throw new Error("当前网络没有题目指定的 MetaMask Delegator 合约")
    await assertSession()
    return status
  }

  // 批次 ID 不是交易哈希。核实单笔规范回执及该区块的委托后，才交给后端核实业务事件。
  async function confirmCalls(id: string, progress: (message: string) => void, poll = true) {
    await assertSession()
    progress("批量存款已提交，正在核实原批次…")
    const deadline = Date.now() + 180_000
    do {
      await assertSession()
      const result = await wallet.getCallsStatus({ id })
      check()
      const receipts = result.receipts ?? []
      if (result.id !== id || result.chainId !== chainId)
        throw new Error("批次编号或网络不匹配，请保留原操作核实")
      if (result.statusCode === 400 && receipts.length === 0)
        throw new AppError("business", "BATCH_FAILED", "钱包未执行批次，可使用原操作继续")
      if (result.status === "success" || result.statusCode === 500) {
        const receipt = receipts[0]
        if (!result.atomic || receipts.length !== 1 || !receipt)
          throw new Error("未取得原子执行的单笔交易凭证，请保留原操作核实")
        if (!/^0x[0-9a-f]{64}$/i.test(receipt.transactionHash)) throw new Error("批次交易哈希无效")
        const canonical = await client.getTransactionReceipt({ hash: receipt.transactionHash })
        if (canonical.blockHash !== receipt.blockHash || canonical.status !== receipt.status)
          throw new Error("批次回执与当前链不一致，请稍后核实")
        if (canonical.status === "reverted")
          throw new AppError("business", "BATCH_FAILED", "批量交易已回滚，可使用原操作继续")
        if (result.status !== "success") throw new Error("批次状态与回执不一致，请核实")
        const code = await client.getCode({ address: account, blockNumber: canonical.blockNumber })
        if (code?.toLowerCase() !== delegationCode)
          throw new Error("交易账户未使用题目指定的 MetaMask Delegator，请保留原操作核实")
        await assertSession()
        return canonical.transactionHash
      }
      if (result.status !== "pending")
        throw new Error("批次失败或状态未知，请保留原操作并在钱包中核实")
      if (!poll) break
      await wait(1_000, signal)
    } while (Date.now() < deadline)
    throw new AppError("timeout", "RESULT_UNKNOWN", "批次结果待核实，请使用原操作继续查询", {
      severity: 2,
    })
  }

  async function transact(
    action: "deposit" | "withdraw",
    text: string,
    progress: (message: string, hash?: Hash) => void,
    operation: {
      id: Hash
      authorization?: Authorization
      expectedAmount?: string
      approvalHash?: Hash
      businessHash?: Hash
      depositMode?: "eip7702"
      callsId?: string
      batchPending?: boolean
      onBatchPending?: () => void
      onCallsId?: (id: string) => void
      onBroadcast: (stage: "approval" | "business", hash: Hash) => void
    }
  ) {
    // 回执只用于推进链上步骤；业务最终确认由后端按确认深度、操作标记和事件重新核实。
    async function confirm(hash: Hash, label: string) {
      check()
      progress(`${label}已提交，等待链上确认…`, hash)
      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        check()
        const receipt = await client.getTransactionReceipt({ hash }).catch((error: unknown) => {
          if (error instanceof TransactionReceiptNotFoundError) return null
          throw error
        })
        check()
        if (receipt) {
          if (receipt.status !== "success")
            throw new AppError("business", "TRANSACTION_REVERTED", `${label}失败，交易已回滚`, {
              severity: 1,
            })
          return receipt.transactionHash
        }
        await wait(1_000, signal)
      }
      throw new AppError("timeout", "RESULT_UNKNOWN", "交易结果待核实，请使用原操作继续查询", {
        severity: 2,
      })
    }
    // 恢复时先等待已知哈希，避免为仍在打包的交易再次请求钱包签名。
    if (operation.depositMode === "eip7702") {
      if (action !== "deposit") throw new Error("批量模式仅支持存款")
      if (operation.authorization === "permit" || operation.authorization === "permit2")
        throw new Error("一次存款只能选择一种授权方式")
      if (operation.callsId) {
        const hash = await confirmCalls(operation.callsId, progress)
        operation.onBroadcast("business", hash)
        return hash
      }
      if (operation.batchPending || operation.businessHash)
        throw new AppError(
          "business",
          "RESULT_UNKNOWN",
          "钱包请求结果不明，请先核实原操作，不能重新发送批次",
          { severity: 2 }
        )
    } else if (operation.businessHash) return confirm(operation.businessHash, "业务交易")
    if (operation.approvalHash) await confirm(operation.approvalHash, "授权")
    const state = await read()
    if (!state.idempotent) throw new Error("该银行为旧版，只支持查看；请配置幂等版银行")
    // 已执行的操作交给服务端核实；不能因余额变化将一次重放误判成新操作。
    const processed = await client.readContract({
      address: bank,
      abi: bankAbi,
      functionName: "operationHash",
      args: [account, operation.id],
    })
    if (processed !== zeroHash) return undefined
    const amount = parseAmount(
      text,
      state.decimals,
      action === "deposit" ? state.walletBalance : state.deposited
    )
    if (operation.expectedAmount !== undefined && amount.toString() !== operation.expectedAmount)
      throw new Error("金额与保存的操作不一致")

    if (operation.depositMode === "eip7702") {
      if (!operation.onCallsId || !operation.onBatchPending)
        throw new Error("批量存款必须保存恢复记录")
      await batchCapability()
      progress("请在 MetaMask 确认一笔存款（授权 + 存款）；首次可能需要升级智能账户…")
      await assertSession()
      operation.onBatchPending()
      // 钱包负责模拟整个批次；单独模拟 deposit 会因尚未执行 approve 而失败。
      // 直接调用 EIP-5792，不启用 viem 的顺序交易 fallback，也不自动重试写入。
      const result = await wallet.request(
        {
          method: "wallet_sendCalls",
          params: [
            {
              version: "2.0.0",
              chainId: numberToHex(chainId),
              from: account,
              atomicRequired: true,
              calls: [
                {
                  to: state.token,
                  data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [bank, amount],
                  }),
                  value: "0x0",
                },
                {
                  to: bank,
                  data: encodeFunctionData({
                    abi: bankAbi,
                    functionName: "deposit",
                    args: [amount, operation.id],
                  }),
                  value: "0x0",
                },
              ],
            },
          ],
        },
        { retryCount: 0 }
      )
      if (!result || typeof result.id !== "string" || !result.id.trim())
        throw new Error("钱包未返回有效批次编号，请保留原操作核实")
      operation.onCallsId(result.id) // 终止或切换账户后晚返回的 ID 也必须保存。
      check()
      const hash = await confirmCalls(result.id, progress)
      operation.onBroadcast("business", hash)
      return hash
    }
    async function broadcast(
      request: Parameters<typeof wallet.writeContract>[0],
      stage: "approval" | "business"
    ) {
      await assertSession()
      const hash = await wallet.writeContract(request)
      operation.onBroadcast(stage, hash)
      check()
      return hash
    }

    if (action === "deposit" && operation.authorization === "permit") {
      if (!state.permitSupported)
        throw new Error("当前银行或 Token 不支持 Permit，请选择普通授权存款")
      const [name, nonce, block] = await Promise.all([
        client.readContract({ address: state.token, abi: erc20Abi, functionName: "name" }),
        client.readContract({
          address: state.token,
          abi: permitAbi,
          functionName: "nonces",
          args: [account],
        }),
        client.getBlock(),
      ])
      const deadline = block.timestamp + 1200n
      await assertSession()
      progress("请签署 Permit 授权（仅本次金额，有效期 20 分钟）…")
      const signature = await wallet.signTypedData({
        account,
        domain: { name, version: "1", chainId, verifyingContract: state.token },
        types: permitTypes,
        primaryType: "Permit",
        message: { owner: account, spender: bank, value: amount, nonce, deadline },
      })
      await assertSession()
      const { r, s, v, yParity } = parseSignature(signature)
      const { request } = await client.simulateContract({
        account,
        address: bank,
        abi: bankAbi,
        functionName: "permitDeposit",
        args: [amount, operation.id, deadline, Number(v ?? BigInt((yParity ?? 0) + 27)), r, s],
      })
      progress("签名完成，请确认存款交易（需要 Gas）…")
      const hash = await broadcast({ ...request, chain: null }, "business")
      return confirm(hash, "签名存款")
    }

    // 授权确认后才发送存款；只授权本次金额，不请求无限额度。
    if (action === "deposit") {
      const spender = operation.authorization === "permit2" ? state.permit2 : bank
      if (!spender) throw new Error("当前银行未配置 Permit2，请选择其他存款方式")
      const allowance = await client.readContract({
        address: state.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, spender],
      })
      if (allowance < amount) {
        progress(
          `请授权 Token 给${operation.authorization === "permit2" ? " Permit2" : "银行"}（仅本次金额）…`
        )
        const { request } = await client.simulateContract({
          account,
          address: state.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, amount],
        })
        await confirm(await broadcast({ ...request, chain: null }, "approval"), "授权")
      }
      if (operation.authorization === "permit2") {
        const deadline = (await client.getBlock()).timestamp + 1200n
        await assertSession()
        progress("请签署 Permit2 授权（仅本次金额，有效期 20 分钟）…")
        const signature = await wallet.signTypedData({
          account,
          domain: { name: "Permit2", chainId, verifyingContract: spender },
          types: permit2Types,
          primaryType: "PermitTransferFrom",
          message: {
            permitted: { token: state.token, amount },
            spender: bank,
            nonce: BigInt(operation.id),
            deadline,
          },
        })
        await assertSession()
        const { request } = await client.simulateContract({
          account,
          address: bank,
          abi: bankAbi,
          functionName: "depositWithPermit2",
          args: [amount, operation.id, deadline, signature],
        })
        progress("Permit2 签名完成，请确认存款交易（需要 Gas）…")
        return confirm(await broadcast({ ...request, chain: null }, "business"), "Permit2 存款")
      }
    }
    const label = action === "deposit" ? "存款" : "取款"
    await assertSession()
    progress(`请在钱包确认${label}…`)
    const { request } = await client.simulateContract({
      account,
      address: bank,
      abi: bankAbi,
      functionName: action,
      args: [amount, operation.id],
    })
    const hash = await broadcast({ ...request, chain: null }, "business")
    return confirm(hash, label)
  }

  return { read, transact, batchCapability, confirmCalls }
}

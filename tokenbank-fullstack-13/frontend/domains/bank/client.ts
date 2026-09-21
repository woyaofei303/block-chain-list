import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  createWalletClient,
  custom,
  type EIP1193Provider,
  erc20Abi,
  type Hash,
  isAddress,
  maxUint256,
  parseAbi,
  parseUnits,
  TransactionReceiptNotFoundError,
  zeroAddress,
  zeroHash,
} from "viem"

import { AppError } from "../../shared/errors.ts"
import { wait } from "../../shared/request.ts"

const bankAbi = parseAbi([
  "function token() view returns (address)",
  "function operationHash(address, bytes32) view returns (bytes32)",
  "function balances(address) view returns (uint256)",
  "function deposit(uint256 amount, bytes32 operationId)",
  "function withdraw(uint256 amount, bytes32 operationId)",
])

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
    await assertSession()
    // 探测新版幂等接口；旧银行仍可读，连接故障则继续抛出，不能误判成“不支持幂等”。
    const idempotent = await client
      .readContract({
        address: bank,
        abi: bankAbi,
        functionName: "operationHash",
        args: [account, zeroHash],
      })
      .then(
        () => true,
        (error: unknown) => {
          check()
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
      )
    return { token, symbol, decimals, walletBalance, deposited, bankAssets, idempotent }
  }

  async function transact(
    action: "deposit" | "withdraw",
    text: string,
    progress: (message: string, hash?: Hash) => void,
    operation: {
      id: Hash
      expectedAmount?: string
      approvalHash?: Hash
      businessHash?: Hash
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
    if (operation.businessHash) return confirm(operation.businessHash, "业务交易")
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

    // 授权确认后才发送存款；只授权本次金额，不请求无限额度。
    if (action === "deposit") {
      const allowance = await client.readContract({
        address: state.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, bank],
      })
      if (allowance < amount) {
        progress("请在钱包确认 Token 授权（仅本次金额）…")
        const { request } = await client.simulateContract({
          account,
          address: state.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [bank, amount],
        })
        await assertSession()
        await confirm(await broadcast({ ...request, chain: null }, "approval"), "授权")
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
    await assertSession()
    const hash = await broadcast({ ...request, chain: null }, "business")
    return confirm(hash, label)
  }

  return { read, transact }
}

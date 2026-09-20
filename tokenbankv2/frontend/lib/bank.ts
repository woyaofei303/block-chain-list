import {
  type Address,
  BaseError,
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
  zeroAddress,
} from "viem"

const bankAbi = parseAbi([
  "function token() view returns (address)",
  "function balances(address) view returns (uint256)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
])

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
}

export function createBank(
  provider: EIP1193Provider,
  chainId: number,
  bank: Address,
  account: Address,
  isCurrent: () => boolean = () => true
) {
  if (!isAddress(bank) || bank === zeroAddress)
    throw new Error("请输入有效的银行合约地址")
  const transport = custom(provider, { retryCount: 0 })
  const client = createPublicClient({ transport, pollingInterval: 1_000 })
  const wallet = createWalletClient({ transport })

  // 每次读取及签名前复核账户和网络，阻止旧会话继续发起交易。
  async function assertSession() {
    const [network, accounts] = await Promise.all([
      client.getChainId(),
      wallet.getAddresses(),
    ])
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
    const [symbol, decimals, walletBalance, deposited, bankAssets] =
      await Promise.all([
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
    return { token, symbol, decimals, walletBalance, deposited, bankAssets }
  }

  async function transact(
    action: "deposit" | "withdraw",
    text: string,
    progress: (message: string, hash?: Hash) => void
  ) {
    const state = await read()
    const amount = parseAmount(
      text,
      state.decimals,
      action === "deposit" ? state.walletBalance : state.deposited
    )

    async function confirm(hash: Hash, label: string) {
      progress(`${label}已提交，等待链上确认…`, hash)
      let replaced = false
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 180_000,
        onReplaced: ({ reason }) => {
          replaced = reason !== "repriced"
        },
      })
      if (replaced) throw new Error("交易已被取消或替换，请核对钱包记录")
      if (receipt.status !== "success")
        throw new Error(`${label}失败，交易已回滚`)
      return receipt.transactionHash
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
        await confirm(
          await wallet.writeContract({ ...request, chain: null }),
          "授权"
        )
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
      args: [amount],
    })
    await assertSession()
    const hash = await wallet.writeContract({ ...request, chain: null })
    return confirm(hash, label)
  }

  return { read, transact }
}

export type Transfer = {
  transactionHash: Hash
  logIndex: number
  blockNumber: string
  fromAddress: Address
  toAddress: Address
  valueRaw: string
}

export async function loadTransfers(
  endpoint: string,
  expected: {
    chainId: number
    token: Address
    account: Address
    decimals: number
  },
  offset = 0
) {
  const query = new URLSearchParams({
    address: expected.account,
    limit: "10",
    offset: String(offset),
  })
  const response = await fetch(`${endpoint}?${query}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok)
    throw new Error(`转账记录服务暂不可用（HTTP ${response.status}）`)
  const data = await response.json()
  if (!data || typeof data !== "object")
    throw new Error("转账记录服务返回了无效数据")
  if (
    data.chainId !== expected.chainId ||
    typeof data.tokenAddress !== "string" ||
    data.tokenAddress.toLowerCase() !== expected.token.toLowerCase() ||
    typeof data.address !== "string" ||
    data.address.toLowerCase() !== expected.account.toLowerCase() ||
    data.decimals !== expected.decimals
  )
    throw new Error("后端网络、Token 或查询地址不匹配，请检查索引器配置")
  if (
    !Array.isArray(data.transfers) ||
    data.transfers.length > 10 ||
    !(
      data.indexedThrough === null ||
      (typeof data.indexedThrough === "string" &&
        /^\d+$/.test(data.indexedThrough))
    ) ||
    !data.transfers.every(
      (row: Transfer) =>
        row != null &&
        typeof row === "object" &&
        typeof row.transactionHash === "string" &&
        /^0x[\da-f]{64}$/i.test(row.transactionHash) &&
        Number.isSafeInteger(row.logIndex) &&
        row.logIndex >= 0 &&
        typeof row.blockNumber === "string" &&
        /^\d+$/.test(row.blockNumber) &&
        typeof row.fromAddress === "string" &&
        isAddress(row.fromAddress, { strict: false }) &&
        typeof row.toAddress === "string" &&
        isAddress(row.toAddress, { strict: false }) &&
        typeof row.valueRaw === "string" &&
        /^\d+$/.test(row.valueRaw) &&
        BigInt(row.valueRaw) <= maxUint256 &&
        [row.fromAddress.toLowerCase(), row.toAddress.toLowerCase()].includes(
          expected.account.toLowerCase()
        )
    )
  )
    throw new Error("转账记录服务返回了无效数据")
  return {
    transfers: data.transfers as Transfer[],
    indexedThrough: data.indexedThrough as string | null,
  }
}

export function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof BaseError) {
    const rejected = error.walk(
      (cause) =>
        !!cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === 4001
    )
    if (rejected) return "已取消钱包请求，请在钱包中确认后重试。"
    if (error.name === "WaitForTransactionReceiptTimeoutError")
      return "确认等待超时，请先查看钱包中的交易状态再决定是否重试。"
    return error.shortMessage
  }
  return error instanceof Error ? error.message : "操作失败，请重试"
}

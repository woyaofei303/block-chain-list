import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  FetchRequest,
  getAddress,
  Interface,
  isError,
  isKeystoreJson,
  JsonRpcProvider,
  keccak256,
  MaxUint256,
  parseUnits,
  Transaction,
  type TransactionRequest,
  Wallet,
  ZeroAddress,
} from 'ethers'

export const CHAIN_ID = 11155111n
export const erc20 = new Interface([
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
])

export class InputError extends Error {}

export function address(value: string): string {
  try {
    const result = getAddress(value)
    if (result !== ZeroAddress) return result
  } catch {}
  throw new InputError('地址无效：请使用非零的完整 Ethereum 地址。')
}

export function amount(value: string, decimals: number): bigint {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    !/^(0|[1-9]\d*)(\.\d+)?$/.test(value) ||
    (value.split('.')[1]?.length ?? 0) > decimals
  ) {
    throw new InputError('金额须为正十进制数，且小数位不能超过代币精度。')
  }
  const result = parseUnits(value, decimals)
  if (result <= 0n || result > MaxUint256) {
    throw new InputError('金额必须大于 0，且不超过 uint256。')
  }
  return result
}

export async function createWallet(file: string, password: string) {
  if (password.length < 12) throw new InputError('密码至少需要 12 个字符。')
  // 只保留随机私钥的钱包，不额外持久化助记词。
  const wallet = new Wallet(Wallet.createRandom().privateKey)
  const encrypted = await wallet.encrypt(password)
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, encrypted, { flag: 'wx', mode: 0o600 })
  return wallet.address
}

export async function walletAddress(file: string): Promise<string> {
  const encrypted = await readFile(file, 'utf8')
  if (!isKeystoreJson(encrypted))
    throw new InputError('不是有效的加密 keystore。')
  const data: unknown = JSON.parse(encrypted)
  if (
    typeof data !== 'object' ||
    data === null ||
    !('address' in data) ||
    typeof data.address !== 'string'
  ) {
    throw new InputError('keystore 缺少公开地址。')
  }
  return address(
    data.address.startsWith('0x') ? data.address : `0x${data.address}`,
  )
}

export function connect(rpcUrl: string | undefined): JsonRpcProvider {
  try {
    const url = new URL(rpcUrl ?? '')
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
  } catch {
    throw new InputError('请在 .env 配置有效的 SEPOLIA_RPC_URL（HTTP/HTTPS）。')
  }
  const request = new FetchRequest(rpcUrl ?? '')
  request.timeout = 15_000
  return new JsonRpcProvider(request, Number(CHAIN_ID), { cacheTimeout: -1 })
}

export async function assertSepolia(provider: JsonRpcProvider) {
  if ((await provider.getNetwork()).chainId !== CHAIN_ID) {
    throw new InputError('网络错误：只允许 Sepolia（11155111）。')
  }
}

export async function tokenBalance(
  provider: JsonRpcProvider,
  token: string,
  owner: string,
) {
  const to = address(token)
  const account = address(owner)
  if ((await provider.getCode(to)) === '0x') {
    throw new InputError('代币地址没有合约代码。')
  }
  const [precision, balance] = await Promise.all([
    provider.call({ to, data: erc20.encodeFunctionData('decimals') }),
    provider.call({
      to,
      data: erc20.encodeFunctionData('balanceOf', [account]),
    }),
  ])
  const decimals = Number(erc20.decodeFunctionResult('decimals', precision)[0])
  const raw: bigint = erc20.decodeFunctionResult('balanceOf', balance)[0]
  return { decimals, raw }
}

export async function buildTransfer(
  provider: JsonRpcProvider,
  input: {
    from: string
    token: string
    to: string
    amount: string
    maxFee: string
  },
) {
  await assertSepolia(provider)
  const from = address(input.from)
  const token = address(input.token)
  const to = address(input.to)
  const maxFeePerGas = amount(input.maxFee, 9)
  const balance = await tokenBalance(provider, token, from)
  const units = amount(input.amount, balance.decimals)
  if (balance.raw < units) throw new InputError('ERC20 余额不足。')
  const [fees, nonce, eth] = await Promise.all([
    provider.getFeeData(),
    provider.getTransactionCount(from, 'pending'),
    provider.getBalance(from, 'pending'),
  ])
  if (fees.maxPriorityFeePerGas === null || fees.maxFeePerGas === null) {
    throw new InputError('RPC 未提供 EIP-1559 费用数据。')
  }
  if (fees.maxPriorityFeePerGas > maxFeePerGas) {
    throw new InputError('费用上限低于建议小费，请重新核对费用上限。')
  }
  const transaction = {
    type: 2,
    chainId: CHAIN_ID,
    from,
    to: token,
    value: 0n,
    data: erc20.encodeFunctionData('transfer', [to, units]),
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  } satisfies TransactionRequest
  const gas = await provider.estimateGas(transaction)
  const gasLimit = (gas * 120n + 99n) / 100n
  const maxCost = gasLimit * maxFeePerGas
  if (eth < maxCost)
    throw new InputError('Sepolia ETH 不足以覆盖 Gas 费用上限。')
  // 带费用的 eth_call 必须限制 gas，避免 RPC 按默认超大值误判 ETH 不足。
  const result = await provider.call({ ...transaction, gasLimit })
  if (erc20.decodeFunctionResult('transfer', result)[0] !== true) {
    throw new InputError('模拟 transfer 返回 false，停止交易。')
  }
  return {
    transaction: { ...transaction, gasLimit },
    recipient: to,
    units,
    decimals: balance.decimals,
    maxCost,
  }
}

export async function signTransfer(
  file: string,
  password: string,
  transaction: Awaited<ReturnType<typeof buildTransfer>>['transaction'],
) {
  if (transaction.chainId !== CHAIN_ID || transaction.type !== 2) {
    throw new InputError('只签名 Sepolia EIP-1559 交易。')
  }
  let wallet: Awaited<ReturnType<typeof Wallet.fromEncryptedJson>>
  try {
    wallet = await Wallet.fromEncryptedJson(
      await readFile(file, 'utf8'),
      password,
    )
  } catch {
    throw new InputError('无法解锁钱包，请检查 keystore 和密码。')
  }
  if (wallet.address !== address(transaction.from)) {
    throw new InputError('keystore 地址与交易发送方不一致。')
  }
  const signed = await wallet.signTransaction(transaction)
  return { signed, hash: keccak256(signed) }
}

export async function broadcast(
  provider: JsonRpcProvider,
  signed: string,
  recordFile: string,
) {
  await assertSepolia(provider)
  const tx = Transaction.from(signed)
  if (tx.chainId !== CHAIN_ID || tx.type !== 2 || !tx.from || !tx.hash) {
    throw new InputError('签名交易不是有效的 Sepolia EIP-1559 交易。')
  }
  if ((await provider.getTransactionCount(tx.from, 'pending')) !== tx.nonce) {
    throw new InputError('nonce 已变化，请重新预览和确认交易。')
  }
  const simulation = await provider.call({
    from: tx.from,
    to: tx.to,
    data: tx.data,
    value: tx.value,
    gasLimit: tx.gasLimit,
    maxFeePerGas: tx.maxFeePerGas,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
  })
  if (erc20.decodeFunctionResult('transfer', simulation)[0] !== true) {
    throw new InputError('广播前模拟失败，停止交易。')
  }
  // 先留存公开哈希；RPC 超时后也能查回执，不自动重发。
  await mkdir(dirname(recordFile), { recursive: true, mode: 0o700 })
  await writeFile(
    recordFile,
    JSON.stringify({
      hash: tx.hash,
      from: tx.from,
      nonce: tx.nonce,
      chainId: Number(CHAIN_ID),
    }),
    { flag: 'wx', mode: 0o600 },
  )
  const response = await provider.broadcastTransaction(signed)
  if (response.hash !== tx.hash)
    throw new InputError('RPC 返回的交易哈希不一致。')
  return response
}

export function safeError(error: unknown): string {
  if (error instanceof InputError) return error.message
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'EEXIST')
      return '目标文件已存在，未覆盖；若为交易记录，请先查询原哈希。'
    if (error.code === 'ENOENT') return '找不到钱包文件，请先运行 create。'
  }
  if (isError(error, 'CALL_EXCEPTION'))
    return '合约调用或交易执行失败，请核对金额、地址和回执。'
  if (isError(error, 'NETWORK_ERROR')) return 'RPC 网络不可用或 chain ID 不符。'
  return '操作失败，请检查参数、RPC、余额及本地文件权限；已签名交易请先查哈希，勿直接重发。'
}

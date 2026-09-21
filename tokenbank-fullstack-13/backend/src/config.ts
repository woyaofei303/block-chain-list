import type { PoolConfig } from 'pg'
import { type Address, isAddress, zeroAddress } from 'viem'
import type { ScanConfig } from './transfers/types.ts'

export type AppConfig = ScanConfig & {
  rpcUrl: string
  host: string
  port: number
  pollInterval: number
  bankAddress?: Address
  publicOrigin: string
  database: PoolConfig
}

// 环境变量均为字符串，先检查范围再转换，避免空值、小数和不安全整数进入业务。
function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  const text = env[name] ?? String(fallback)
  const value = Number(text)
  if (
    !/^\d+$/.test(text) ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`${name} must be an integer in ${min}..${max}`)
  }
  return value
}

// npm 脚本负责加载 .env；此函数只读取并校验配置，不连接 RPC 或数据库。
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rpcUrl = env.RPC_URL ?? 'http://127.0.0.1:18545'
  if (
    !URL.canParse(rpcUrl) ||
    !['http:', 'https:'].includes(new URL(rpcUrl).protocol)
  ) {
    throw new Error('RPC_URL must be an HTTP(S) URL')
  }
  const tokenAddress = env.TOKEN_ADDRESS ?? ''
  if (!isAddress(tokenAddress) || tokenAddress === zeroAddress)
    throw new Error('TOKEN_ADDRESS must be a valid Ethereum address')

  const publicOrigin = env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:3180'
  if (
    !URL.canParse(publicOrigin) ||
    !['http:', 'https:'].includes(new URL(publicOrigin).protocol) ||
    new URL(publicOrigin).origin !== publicOrigin
  )
    throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin')
  const bankAddress = env.BANK_ADDRESS
  if (bankAddress && (!isAddress(bankAddress) || bankAddress === zeroAddress))
    throw new Error('BANK_ADDRESS must be valid')
  return {
    bankAddress: bankAddress as Address | undefined,
    publicOrigin,
    rpcUrl,
    chainId: integer(env, 'CHAIN_ID', 31337, 1),
    tokenAddress: tokenAddress.toLowerCase() as Address,
    // Viem 区块参数使用 bigint，HTTP 端口和轮询间隔使用 number。
    startBlock: BigInt(integer(env, 'START_BLOCK', 0)),
    confirmations: BigInt(integer(env, 'CONFIRMATIONS', 12)),
    batchSize: BigInt(integer(env, 'BATCH_SIZE', 2000, 1)),
    host: env.HOST ?? '127.0.0.1',
    port: integer(env, 'PORT', 3001, 1, 65535),
    pollInterval: integer(env, 'POLL_INTERVAL_MS', 12000, 100),
    // pg 自行读取 PGHOST/PGPORT/PGUSER/PGPASSWORD；连接信息不要输出到日志。
    database: {
      connectionString: env.DATABASE_URL,
      database: env.PGDATABASE || 'tokenbank_indexer',
      max: 4,
      connectionTimeoutMillis: 5000,
    },
  }
}

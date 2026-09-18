import { isAddress } from 'viem'

// 环境变量均为字符串，先检查范围再转换，避免空值、小数和不安全整数进入业务。
function integer(env, name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
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
export function loadConfig(env = process.env) {
  const rpcUrl = env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
  if (
    !URL.canParse(rpcUrl) ||
    !['http:', 'https:'].includes(new URL(rpcUrl).protocol)
  ) {
    throw new Error('RPC_URL must be an HTTP(S) URL')
  }
  const tokenAddress =
    env.TOKEN_ADDRESS ?? '0xaa0ce32d799459b6a617a0c07cfc79b4048e4dbc'
  if (!isAddress(tokenAddress))
    throw new Error('TOKEN_ADDRESS must be a valid Ethereum address')

  return {
    rpcUrl,
    chainId: integer(env, 'CHAIN_ID', 11155111, 1),
    tokenAddress: tokenAddress.toLowerCase(),
    // Viem 区块参数使用 bigint，HTTP 端口和轮询间隔使用 number。
    startBlock: BigInt(integer(env, 'START_BLOCK', 11702875)),
    confirmations: BigInt(integer(env, 'CONFIRMATIONS', 12)),
    batchSize: BigInt(integer(env, 'BATCH_SIZE', 2000, 1)),
    host: env.HOST ?? '127.0.0.1',
    port: integer(env, 'PORT', 3001, 1, 65535),
    pollInterval: integer(env, 'POLL_INTERVAL_MS', 12000, 100),
    // pg 自行读取 PGHOST/PGPORT/PGUSER/PGPASSWORD；连接信息不要输出到日志。
    database: {
      connectionString: env.DATABASE_URL,
      database: env.PGDATABASE || 'erc20_indexer',
      max: 4,
      connectionTimeoutMillis: 5000,
    },
  }
}

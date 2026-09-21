import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import pg from 'pg'
import { createPublicClient, erc20Abi, http } from 'viem'
import { createApp } from './app.mjs'
import { loadConfig } from './config.mjs'
import { initDatabase } from './database.mjs'
import { scanOnce } from './indexer.mjs'

// 启动入口按顺序组装配置、RPC、数据库和 HTTP 服务。
const config = loadConfig()
const rpc = createPublicClient({
  transport: http(config.rpcUrl, { timeout: 15000, retryCount: 2 }),
})
const db = new pg.Pool(config.database)
// Ctrl+C / SIGTERM 阻止下一轮扫描，并打断轮询等待；正在执行的扫描会先结束。
const abort = new AbortController()
const stop = () => abort.abort()
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
let server
// 不打印数据库或 RPC 原始错误，避免把带凭据的连接字符串写进日志。
db.on('error', () => {
  console.error('PostgreSQL connection lost')
  stop()
})
try {
  // 1. 先核对网络，防止把其他链的数据写到配置的 chainId 下。
  if ((await rpc.getChainId()) !== config.chainId)
    throw new Error('RPC chain does not match CHAIN_ID')
  // 精度必须从合约读取，不能假设所有 ERC20 都是 18 位。
  // symbol 仅用于展示，读取失败可为 null；decimals 失败则无法可靠展示金额，启动失败。
  const decimals = await rpc.readContract({
    address: config.tokenAddress,
    abi: erc20Abi,
    functionName: 'decimals',
  })
  const symbol = await rpc
    .readContract({
      address: config.tokenAddress,
      abi: erc20Abi,
      functionName: 'symbol',
    })
    .catch(() => null)
  // 2. 幂等建表：重复启动保留已有转账和扫描进度。
  await initDatabase(db)
  if (process.argv.includes('--once')) {
    // npm run scan：扫到本轮确认高度后退出，不启动 HTTP 服务。
    const indexedThrough = await scanOnce(db, rpc, config)
    console.log(
      JSON.stringify({
        chainId: config.chainId,
        tokenAddress: config.tokenAddress,
        indexedThrough: indexedThrough.toString(),
      }),
    )
  } else {
    // npm start：先开放数据库查询，再补历史记录；查询结果包含 indexedThrough 进度。
    const app = createApp(db, config, { symbol, decimals })
    server = app.listen(config.port, config.host)
    await once(server, 'listening')
    console.log(`API ready at http://${config.host}:${config.port}/transfers`)
    // 每轮 await 完成后再等待，避免 setInterval 导致慢请求与下一轮扫描重叠。
    while (!abort.signal.aborted) {
      try {
        const height = await scanOnce(db, rpc, config)
        console.log(`Indexed through block ${height}`)
      } catch {
        // scanOnce 已回滚失败批次；之前成功的批次仍保留，下一轮从保存的进度重试。
        console.error(
          'Scan failed; saved progress retained. Check RPC/database/config; retrying next poll.',
        )
      }
      await sleep(config.pollInterval, undefined, {
        signal: abort.signal,
      }).catch(() => {})
    }
  }
} catch {
  console.error(
    'Startup/scan failed. Check PostgreSQL, RPC_URL, CHAIN_ID, TOKEN_ADDRESS and START_BLOCK.',
  )
  process.exitCode = 1
} finally {
  // 3. 退出时先停止接收 HTTP 请求，再关闭连接池，释放数据库连接。
  if (server?.listening) await new Promise((resolve) => server.close(resolve))
  await db.end()
}

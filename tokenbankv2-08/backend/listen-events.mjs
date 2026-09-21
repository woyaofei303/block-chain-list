import { createPublicClient, http, isAddress, parseAbi } from 'viem'
import { base } from 'viem/chains'

const { BASE_RPC, MARKET_ADDRESS } = process.env

// 启动时尽早检查配置，避免监听器运行后才暴露地址或 RPC 错误。
if (!BASE_RPC || !URL.canParse(BASE_RPC) || !['http:', 'https:'].includes(new URL(BASE_RPC).protocol)) {
  throw new Error('BASE_RPC must be an HTTP(S) RPC URL')
}
if (!MARKET_ADDRESS || !isAddress(MARKET_ADDRESS)) {
  throw new Error('MARKET_ADDRESS must be a valid contract address')
}

const client = createPublicClient({ chain: base, transport: http(BASE_RPC) })
// 监听事件只需要 ABI 中的 event 定义，无需复制整份合约 ABI。
const abi = parseAbi([
  'event NFTListed(address indexed seller, uint256 indexed tokenId, uint256 price)',
  'event NFTSold(address indexed seller, address indexed buyer, uint256 indexed tokenId, uint256 price)',
])

const printLogs = (logs) => {
  for (const log of logs) {
    // JSON 不支持 bigint，输出前把 tokenId 和 price 转成十进制字符串。
    console.log(JSON.stringify(
      { eventName: log.eventName, ...log.args, transactionHash: log.transactionHash },
      (_, value) => typeof value === 'bigint' ? value.toString() : value,
    ))
  }
}

// 从启动后的下一个区块开始，只打印新发生的上架和成交。
let nextBlock = await client.getBlockNumber() + 1n
// 串行处理区块，避免 RPC 较慢时多个轮询重叠并重复读取同一区间。
let queue = Promise.resolve()
const stop = client.watchBlockNumber({
  emitOnBegin: true,
  onBlockNumber(latestBlock) {
    queue = queue
      .then(async () => {
        if (latestBlock < nextBlock) return
        // 一次读取 nextBlock..latestBlock，轮询错过区块时也不会漏掉事件。
        printLogs(await client.getContractEvents({
          address: MARKET_ADDRESS,
          abi,
          fromBlock: nextBlock,
          toBlock: latestBlock,
        }))
        nextBlock = latestBlock + 1n
      })
      .catch(console.error)
  },
  onError: console.error,
})

console.log(`Listening for NFTMarket events at ${MARKET_ADDRESS}`)

// 释放 Viem 的轮询定时器，让 Ctrl+C 干净退出。
process.once('SIGINT', () => {
  stop()
  process.exit(0)
})

import {
  type Address,
  createPublicClient,
  http,
  isAddress,
  keccak256,
  type PublicClient,
  toHex,
} from 'viem'

export type LockInfo = {
  user: Address
  startTime: bigint
  amount: bigint
}

/** 在指定区块读取题目合约的全部 _locks；无效地址、无代码或不完整 RPC 数据会报错。 */
export async function readLocks(
  client: PublicClient,
  address: string,
  blockNumber: bigint,
): Promise<LockInfo[]> {
  if (!isAddress(address)) throw new Error('CONTRACT_ADDRESS 不是有效地址')
  const target = address
  if (blockNumber < 0n) throw new Error('BLOCK_NUMBER 必须非负')
  const code = await client.getCode({ address, blockNumber })
  if (!code || code === '0x') throw new Error('指定区块的目标地址没有合约代码')

  /** 通过 getStorageAt 读取一个完整的 32 字节槽；不把缺失响应冒充零值。 */
  async function readWord(slot: bigint): Promise<bigint> {
    const word = await client.getStorageAt({
      address: target,
      slot: toHex(slot, { size: 32 }),
      blockNumber,
    })
    if (!word || !/^0x[0-9a-fA-F]{64}$/.test(word)) {
      throw new Error(`slot ${slot} 未返回完整的 32 字节存储值`)
    }
    return BigInt(word)
  }

  // 数组长度来自 slot 0；keccak256 的输入必须是补齐到 32 字节的槽编号。
  const length = await readWord(0n)
  const base = BigInt(keccak256(toHex(0n, { size: 32 })))
  const locks: LockInfo[] = []
  for (let i = 0n; i < length; i++) {
    // 每项占两槽：第 0 项读 base/base+1，第 1 项读 base+2/base+3。
    const slot = base + i * 2n
    const [packed, amount] = await Promise.all([
      readWord(slot),
      readWord(slot + 1n),
    ])
    // 从低位依次取 address(20 字节)、uint64(8 字节)，amount 保持 bigint 精度。
    locks.push({
      user: toHex(packed & ((1n << 160n) - 1n), { size: 20 }),
      startTime: (packed >> 160n) & ((1n << 64n) - 1n),
      amount,
    })
  }
  return locks
}

/** 校验 CLI 配置，固定读取区块并打印原始整数；只读 RPC，不创建钱包或发送交易。 */
async function main(): Promise<void> {
  const rpc = new URL(process.env.RPC_URL ?? 'http://127.0.0.1:18548')
  if (rpc.protocol !== 'http:' && rpc.protocol !== 'https:') {
    throw new Error('RPC_URL 必须使用 HTTP 或 HTTPS')
  }
  const address = process.env.CONTRACT_ADDRESS ?? ''
  if (!isAddress(address)) throw new Error('请设置有效的 CONTRACT_ADDRESS')
  const requestedBlock = process.env.BLOCK_NUMBER
  if (requestedBlock !== undefined && !/^\d+$/.test(requestedBlock)) {
    throw new Error('BLOCK_NUMBER 必须是非负十进制整数')
  }
  const client = createPublicClient({ transport: http(rpc.href) })
  const blockNumber =
    requestedBlock === undefined
      ? await client.getBlockNumber()
      : BigInt(requestedBlock)
  const [chainId, block, locks] = await Promise.all([
    client.getChainId(),
    client.getBlock({ blockNumber }),
    readLocks(client, address, blockNumber),
  ])
  // 不输出 RPC_URL，避免日志泄露提供商 URL 中的凭据。
  console.log(`chainId: ${chainId}, contract: ${address}`)
  console.log(`blockNumber: ${blockNumber}, blockHash: ${block.hash}`)
  console.log(
    `blockTimestamp: ${block.timestamp}, locks.length: ${locks.length}`,
  )
  for (const [i, lock] of locks.entries()) {
    console.log(
      `locks[${i}]: user:${lock.user} ,startTime:${lock.startTime},amount:${lock.amount}`,
    )
  }
}

if (import.meta.main) {
  try {
    await main()
  } catch {
    // RPC 异常可能包含完整请求 URL；对外只输出可操作的排查信息。
    console.error(
      '读取失败：请检查 RPC_URL、CONTRACT_ADDRESS、BLOCK_NUMBER、合约布局及 RPC 历史状态支持。',
    )
    process.exitCode = 1
  }
}

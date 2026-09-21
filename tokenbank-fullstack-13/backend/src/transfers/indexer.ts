import type { Pool } from 'pg'
import {
  type Address,
  type GetLogsReturnType,
  type Hash,
  type PublicClient,
  parseAbiItem,
} from 'viem'
import type { ScanConfig } from './types.ts'

// 只需 Transfer 的事件定义即可解码，无需复制合约的完整 ABI。
// from/to 是 indexed 参数，来自 topics；value 是非 indexed 参数，来自 data。
const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
)

type TransferLog = Pick<
  GetLogsReturnType<
    typeof transferEvent,
    [typeof transferEvent],
    true,
    bigint,
    bigint
  >[number],
  'blockNumber' | 'blockHash' | 'transactionHash' | 'logIndex' | 'args'
>

// 只声明扫描实际使用的 RPC 能力；真实 Viem 客户端和测试节点共用此约束。
export type ScannerRpc = {
  getBlockNumber: PublicClient['getBlockNumber']
  getBlock: (parameters: {
    blockNumber: bigint
  }) => Promise<{ hash: Hash | null }>
  getLogs: (parameters: {
    address: Address
    event: typeof transferEvent
    fromBlock: bigint
    toBlock: bigint
    strict: true
  }) => Promise<TransferLog[]>
}

type ScanProgress = {
  start_block: string
  next_block: string
  block_hash: string | null
}

export async function scanOnce(
  db: Pool,
  rpc: ScannerRpc,
  config: ScanConfig,
): Promise<bigint> {
  const { chainId, tokenAddress, startBlock, confirmations, batchSize } = config
  // 所有进度、删除和查询都按“链 + 代币”隔离，地址统一小写便于匹配。
  const key = [chainId, tokenAddress.toLowerCase()]
  // 同一个事务必须始终使用同一连接，不能在 BEGIN 后改用 db.query 随机借连接。
  const client = await db.connect()
  try {
    // 1. 首次从部署块开始；已存在进度时不覆盖，重启自然从上次提交处继续。
    await client.query(
      `INSERT INTO scan_progress (chain_id, token_address, start_block, next_block)
      VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
      [...key, startBlock.toString()],
    )
    // 2. 固定本轮扫描上限，避免追着不断增长的链头一直运行。
    // 例如 head=120、confirmations=12，本轮最多处理到区块 108（含）。
    const head = await rpc.getBlockNumber()
    const target = head - confirmations
    for (;;) {
      await client.query('BEGIN')
      // 3. 锁住这一条进度，其他扫描进程需等本批提交后才能继续推进它。
      const {
        rows: [progress],
      } = await client.query<ScanProgress>(
        'SELECT * FROM scan_progress WHERE chain_id = $1 AND token_address = $2 FOR UPDATE',
        key,
      )
      // 起始块定义了索引覆盖范围，中途改配置可能留下缺失历史，因此直接拒绝。
      if (BigInt(progress.start_block) !== startBlock) {
        throw new Error(
          'START_BLOCK differs from saved progress; use a separate database to re-index',
        )
      }
      const fromBlock = BigInt(progress.next_block)
      // 等待行锁期间，其他进程可能已推进进度；必要时刷新链头，避免误判为链回退。
      const checkpointHead =
        fromBlock - 1n > head
          ? await rpc.getBlockNumber({ cacheTime: 0 })
          : head
      // 4. 已保存的检查点消失或哈希改变，表示当前 RPC 看到的链与本地历史不一致。
      // 删除此链此代币的旧记录并重置进度，同一事务提交后重新从部署块扫描。
      if (
        progress.block_hash &&
        (fromBlock - 1n > checkpointHead ||
          (await rpc.getBlock({ blockNumber: fromBlock - 1n })).hash !==
            progress.block_hash)
      ) {
        // ponytail: 作业数据量小，重组后从部署块重扫；大规模索引再保存分段检查点。
        await client.query(
          'DELETE FROM transfers WHERE chain_id = $1 AND token_address = $2',
          key,
        )
        await client.query(
          'UPDATE scan_progress SET next_block = start_block, block_hash = NULL WHERE chain_id = $1 AND token_address = $2',
          key,
        )
        await client.query('COMMIT')
        continue
      }
      if (fromBlock > target) {
        // 本轮已追上确认高度；COMMIT 释放行锁，返回已覆盖的最后一个区块。
        await client.query('COMMIT')
        return fromBlock - 1n
      }
      // 5. 查询闭区间 [fromBlock, toBlock]，最多 batchSize 块，不超过本轮上限。
      const toBlock =
        fromBlock + batchSize - 1n < target
          ? fromBlock + batchSize - 1n
          : target
      const block = await rpc.getBlock({ blockNumber: toBlock })
      // address 限定发出事件的代币合约；strict 要求日志参数符合 Transfer ABI。
      // Viem 返回已解码的 log.args.from / to / value，value 为 bigint。
      const logs = await rpc.getLogs({
        address: tokenAddress,
        event: transferEvent,
        fromBlock,
        toBlock,
        strict: true,
      })
      // 读日志后再核对批次末块和旧检查点，发现期间换链就放弃本批。
      // 旧检查点也要复查，防止把新分支的日志接到旧分支历史后面。
      if (
        (await rpc.getBlock({ blockNumber: toBlock })).hash !== block.hash ||
        (progress.block_hash &&
          (await rpc.getBlock({ blockNumber: fromBlock - 1n })).hash !==
            progress.block_hash)
      ) {
        throw new Error('Chain changed during scan; retry this batch')
      }
      // 6. 明细与进度一起写入事务。主键冲突时跳过，重复日志不会重复入库。
      // 金额直接 bigint → 十进制字符串，不能先转 Number，否则可能丢失精度。
      for (const log of logs) {
        await client.query(
          `INSERT INTO transfers VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT DO NOTHING`,
          [
            ...key,
            log.blockNumber.toString(),
            log.blockHash,
            log.transactionHash,
            log.logIndex,
            log.args.from.toLowerCase(),
            log.args.to.toLowerCase(),
            log.args.value.toString(),
          ],
        )
      }
      // 7. 即使本批没有 Transfer 也推进进度，因为这段区块已经查询过。
      // next_block=toBlock+1，配套保存 toBlock 的哈希，供下一批/重启时核对。
      await client.query(
        `UPDATE scan_progress SET next_block = $3, block_hash = $4
        WHERE chain_id = $1 AND token_address = $2`,
        [...key, (toBlock + 1n).toString(), block.hash],
      )
      await client.query('COMMIT')
    }
  } catch (error) {
    // 本批任何 RPC/SQL 失败都不保留半批结果；之前 COMMIT 的批次不受影响。
    await client.query('ROLLBACK')
    throw error
  } finally {
    // 成功、失败都归还连接，避免长期运行耗尽连接池。
    client.release()
  }
}

import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import type { TransferPage, TransferQuery, TransferScope } from './types.ts'

const schema = await readFile(
  new URL('../../../database/schema.sql', import.meta.url),
  'utf8',
)

export async function initDatabase(db: Pick<Pool, 'query'>) {
  await db.query(schema)
}

export async function findTransfers(
  db: Pick<Pool, 'query'>,
  { chainId, tokenAddress }: TransferScope,
  { address, limit, offset }: TransferQuery,
): Promise<TransferPage> {
  // 一条 SQL 同时读取进度和明细，保证它们来自同一次查询的数据快照。
  // from OR to 覆盖收支，自转账只匹配一行；参数化查询避免拼接用户输入。
  // json_agg 聚合本页记录，COALESCE 将“没有记录”的 null 转为 []。
  const {
    rows: [result],
  } = await db.query<TransferPage>(
    `WITH page AS (
      SELECT
        block_number::text AS "blockNumber",
        block_hash AS "blockHash",
        transaction_hash AS "transactionHash",
        log_index AS "logIndex",
        from_address AS "fromAddress",
        to_address AS "toAddress",
        value_raw::text AS "valueRaw"
      FROM transfers
      WHERE chain_id = $1 AND token_address = $2
        AND (from_address = $3 OR to_address = $3)
      ORDER BY block_number DESC, log_index DESC
      LIMIT $4 OFFSET $5
    )
    SELECT
      (
        SELECT (next_block - 1)::text
        FROM scan_progress
        WHERE chain_id = $1 AND token_address = $2
          AND block_hash IS NOT NULL
      ) AS "indexedThrough",
      COALESCE((SELECT json_agg(page) FROM page), '[]'::json) AS transfers`,
    [chainId, tokenAddress.toLowerCase(), address, limit, offset],
  )
  return result
}

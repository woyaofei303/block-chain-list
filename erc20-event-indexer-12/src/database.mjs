export async function initDatabase(db) {
  // scan_progress 保存“下一块从哪里开始”；block_hash 对应 next_block - 1。
  // transfers 保存事件明细。一个交易可有多条 Transfer，主键必须包含 log_index。
  // numeric(78,0) 可容纳 uint256 的十进制整数；出入 API 时仍使用字符串。
  // 两个地址索引分别服务于转出/转入查询；同一地址的自转账仍然只有一条明细。
  await db.query(`
    CREATE TABLE IF NOT EXISTS scan_progress (
      chain_id bigint NOT NULL,
      token_address text NOT NULL,
      start_block bigint NOT NULL,
      next_block bigint NOT NULL,
      block_hash text,
      PRIMARY KEY (chain_id, token_address)
    );
    CREATE TABLE IF NOT EXISTS transfers (
      chain_id bigint NOT NULL,
      token_address text NOT NULL,
      block_number bigint NOT NULL,
      block_hash text NOT NULL,
      transaction_hash text NOT NULL,
      log_index integer NOT NULL,
      from_address text NOT NULL,
      to_address text NOT NULL,
      value_raw numeric(78, 0) NOT NULL CHECK (value_raw >= 0),
      PRIMARY KEY (chain_id, token_address, transaction_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS transfers_from
      ON transfers (chain_id, token_address, from_address, block_number DESC, log_index DESC);
    CREATE INDEX IF NOT EXISTS transfers_to
      ON transfers (chain_id, token_address, to_address, block_number DESC, log_index DESC);
  `)
}

export async function findTransfers(
  db,
  { chainId, tokenAddress },
  { address, limit, offset },
) {
  // 一条 SQL 同时读取进度和明细，保证它们来自同一次查询的数据快照。
  // from OR to 覆盖收支，自转账只匹配一行；参数化查询避免拼接用户输入。
  // json_agg 聚合本页记录，COALESCE 将“没有记录”的 null 转为 []。
  const {
    rows: [result],
  } = await db.query(
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
      ) AS "indexedThrough",
      COALESCE((SELECT json_agg(page) FROM page), '[]'::json) AS transfers`,
    [chainId, tokenAddress.toLowerCase(), address, limit, offset],
  )
  return result
}

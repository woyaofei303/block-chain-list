import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import pg from 'pg'
import { createApp } from '../src/app.mjs'
import { initDatabase } from '../src/database.mjs'
import { scanOnce } from '../src/indexer.mjs'

const token = `0x${'a'.repeat(40)}`
const alice = `0x${'1'.repeat(40)}`
const bob = `0x${'2'.repeat(40)}`
const hash = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`

test('扫块落库后，可通过 HTTP 查询收支、准确金额，并在重启后续扫', async (t) => {
  // 只创建、删除本次测试独有的 schema，不改动已保存的作业数据。
  const schema = `erc20_test_${process.pid}_${Date.now()}`
  const admin = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    database: process.env.PGDATABASE || 'erc20_indexer',
  })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    database: process.env.PGDATABASE || 'erc20_indexer',
    options: `-c search_path=${schema}`,
  })
  t.after(async () => {
    await db.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  })
  const config = {
    chainId: 31337,
    tokenAddress: token,
    startBlock: 10n,
    confirmations: 2n,
    batchSize: 2n,
  }
  let head = 13n
  const calls = []
  const rpc = {
    getBlockNumber: async () => head,
    getBlock: async ({ blockNumber }) => ({ hash: hash(blockNumber) }),
    getLogs: async ({ fromBlock, toBlock }) => {
      calls.push([fromBlock, toBlock])
      return [
        {
          blockNumber: 10n,
          blockHash: hash(10),
          transactionHash: hash(100),
          logIndex: 0,
          args: {
            from: alice,
            to: bob,
            value: 123456789012345678901234567890n,
          },
        },
        {
          blockNumber: 10n,
          blockHash: hash(10),
          transactionHash: hash(100),
          logIndex: 1,
          args: { from: bob, to: alice, value: 7n },
        },
        {
          blockNumber: 11n,
          blockHash: hash(11),
          transactionHash: hash(101),
          logIndex: 0,
          args: { from: alice, to: alice, value: 0n },
        },
      ]
        .filter(
          (log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock,
        )
        .flatMap((log) => [log, log])
    },
  }
  await initDatabase(db)
  await scanOnce(db, rpc, config)
  const app = createApp(db, config, { symbol: 'TEST', decimals: 18 })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${base}/transfers?address=${alice}`)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.transfers.length, 3)
  assert.equal(result.transfers[2].valueRaw, '123456789012345678901234567890')
  assert.equal(result.transfers[2].value, '123456789012.34567890123456789')
  assert.equal(result.indexedThrough, '11')
  await scanOnce(db, rpc, config)
  assert.deepEqual(calls, [[10n, 11n]])
  head = 14n
  await scanOnce(db, rpc, config)
  assert.deepEqual(calls.at(-1), [12n, 12n])
  assert.equal(
    (await (await fetch(`${base}/transfers?address=${bob}`)).json()).transfers
      .length,
    2,
  )
  assert.equal((await fetch(`${base}/transfers?address=invalid`)).status, 400)
  for (const query of [
    'limit=0',
    'limit=101',
    'offset=-1',
    'offset=1.5',
    'offset=9007199254740992',
  ]) {
    assert.equal(
      (await fetch(`${base}/transfers?address=${alice}&${query}`)).status,
      400,
    )
  }
  const page = await (
    await fetch(`${base}/transfers?address=${alice}&limit=1&offset=1`)
  ).json()
  assert.equal(page.transfers.length, 1)
  assert.equal(page.transfers[0].logIndex, 1)
  assert.equal(
    (await (await fetch(`${base}/transfers?address=${token}`)).json()).transfers
      .length,
    0,
  )
  assert.equal((await fetch(`${base}/missing`)).status, 404)
  assert.equal(
    (await fetch(`${base}/transfers?address=${alice}`, { method: 'POST' }))
      .status,
    405,
  )

  // 一批数据中途失败：第一条也不能残留，进度不能提前。
  const originalGetLogs = rpc.getLogs
  head = 16n
  rpc.getLogs = async () => [
    {
      blockNumber: 13n,
      blockHash: hash(13),
      transactionHash: hash(103),
      logIndex: 0,
      args: { from: alice, to: bob, value: 9n },
    },
    {
      blockNumber: 14n,
      blockHash: hash(14),
      transactionHash: hash(104),
      logIndex: 0,
      args: { from: alice, to: bob, value: -1n },
    },
  ]
  await assert.rejects(scanOnce(db, rpc, config))
  let afterFailure = await (
    await fetch(`${base}/transfers?address=${alice}`)
  ).json()
  assert.equal(afterFailure.transfers.length, 3)
  assert.equal(afterFailure.indexedThrough, '12')
  rpc.getLogs = async () => {
    throw new Error('RPC unavailable')
  }
  await assert.rejects(scanOnce(db, rpc, config), /RPC unavailable/)
  afterFailure = await (
    await fetch(`${base}/transfers?address=${alice}`)
  ).json()
  assert.equal(afterFailure.indexedThrough, '12')

  // 旧检查点在读日志期间才变化，也不能把新分支接到旧历史后面。
  rpc.getLogs = originalGetLogs
  let checkpointReads = 0
  rpc.getBlock = async ({ blockNumber }) => ({
    hash:
      blockNumber === 12n && ++checkpointReads > 1
        ? hash(1012)
        : hash(blockNumber),
  })
  await assert.rejects(scanOnce(db, rpc, config), /Chain changed/)

  // 已保存的区块被替换：撤回旧分支记录，重新索引。
  rpc.getBlock = async ({ blockNumber }) => ({
    hash: hash(blockNumber + 1000n),
  })
  rpc.getLogs = async (range) =>
    (await originalGetLogs(range))
      .slice(0, 1)
      .map((log) => ({ ...log, blockHash: hash(log.blockNumber + 1000n) }))
  await scanOnce(db, rpc, config)
  const afterReorg = await (
    await fetch(`${base}/transfers?address=${alice}`)
  ).json()
  assert.equal(afterReorg.transfers.length, 1)
  assert.equal(afterReorg.transfers[0].blockHash, hash(1010))
  assert.equal(afterReorg.indexedThrough, '14')
})

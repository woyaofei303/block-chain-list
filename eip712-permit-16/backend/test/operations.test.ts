import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import type { Address, Hash } from 'viem'
import { createOperation, getOperation } from '../src/operations/repository.ts'
import { initDatabase } from '../src/transfers/repository.ts'

test('并发重放只产生一条操作，参数冲突拒绝、重启后保留且账户隔离', async (t) => {
  const connection = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : undefined
  connection?.searchParams.delete('options')
  const options = {
    connectionString: connection?.href,
    database: process.env.PGDATABASE || 'postgres',
  }
  const admin = new pg.Pool(options)
  const schema = `operations_${process.pid}_${Date.now()}`
  await admin.query(`CREATE SCHEMA ${schema}`)
  let db = new pg.Pool({ ...options, options: `-c search_path=${schema}` })
  t.after(async () => {
    await db.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  })
  await initDatabase(db)
  const account: Address = `0x${'1'.repeat(40)}`
  const input = {
    operationId: `0x${'1'.repeat(64)}` as Hash,
    chainId: 31337,
    bankAddress: `0x${'2'.repeat(40)}` as Address,
    action: 'deposit' as const,
    amountRaw: '90071992547409931234',
  }
  const results = await Promise.all(
    Array.from({ length: 30 }, () => createOperation(db, account, input, 1n)),
  )
  for (const result of results) assert.deepEqual(result, results[0])
  assert.equal(
    (await db.query('SELECT COUNT(*)::int AS n FROM operations')).rows[0].n,
    1,
  )
  await assert.rejects(
    createOperation(db, account, { ...input, amountRaw: '1' }, 1n),
    /不同的请求/,
  )
  await db.end()
  db = new pg.Pool({ ...options, options: `-c search_path=${schema}` })
  assert.deepEqual(
    await getOperation(db, account, input.operationId),
    results[0],
  )
  await assert.rejects(
    getOperation(db, input.bankAddress, input.operationId),
    /不存在/,
  )
})

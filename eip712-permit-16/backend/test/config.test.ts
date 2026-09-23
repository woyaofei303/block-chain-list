import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config.ts'

test('独立项目默认使用本地链，要求明确指定 Token，并拒绝非法配置', () => {
  const token = `0x${'1'.repeat(40)}`
  const defaults = loadConfig({ TOKEN_ADDRESS: token })
  assert.equal(defaults.chainId, 31337)
  assert.equal(defaults.rpcUrl, 'http://127.0.0.1:8547')
  assert.equal(defaults.startBlock, 0n)
  assert.equal(defaults.port, 13016)
  assert.equal(defaults.database.database, 'tokenbank_permit_16')
  assert.throws(() => loadConfig({}), /TOKEN_ADDRESS/)
  assert.throws(
    () => loadConfig({ TOKEN_ADDRESS: `0x${'0'.repeat(40)}` }),
    /TOKEN_ADDRESS/,
  )
  const custom = loadConfig({
    CHAIN_ID: '31337',
    START_BLOCK: '0',
    CONFIRMATIONS: '0',
    BATCH_SIZE: '3',
    RPC_URL: 'http://127.0.0.1:8545',
    PORT: '4000',
    POLL_INTERVAL_MS: '100',
    TOKEN_ADDRESS: `0x${'1'.repeat(40)}`,
    PGDATABASE: 'test_indexer',
  })
  assert.equal(custom.startBlock, 0n)
  assert.equal(custom.batchSize, 3n)
  assert.equal(custom.confirmations, 0n)
  assert.equal(custom.port, 4000)
  assert.equal(custom.pollInterval, 100)
  assert.equal(custom.database.database, 'test_indexer')
  for (const [name, value] of [
    ['RPC_URL', 'file:///tmp/rpc'],
    ['TOKEN_ADDRESS', 'invalid'],
    ['CHAIN_ID', '0'],
    ['START_BLOCK', '-1'],
    ['BATCH_SIZE', '0'],
    ['PORT', '65536'],
    ['POLL_INTERVAL_MS', '99'],
    ['CONFIRMATIONS', '1.5'],
    ['START_BLOCK', '9007199254740992'],
    ['PORT', ''],
  ]) {
    assert.throws(
      () => loadConfig({ TOKEN_ADDRESS: token, [name]: value }),
      new RegExp(name),
    )
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config.mjs'

test('配置保留现有默认值，正确转换覆盖值，并尽早拒绝非法输入', () => {
  const defaults = loadConfig({})
  assert.equal(defaults.chainId, 11155111)
  assert.equal(defaults.startBlock, 11702875n)
  assert.equal(defaults.port, 3001)
  assert.equal(defaults.database.database, 'erc20_indexer')
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
    assert.throws(() => loadConfig({ [name]: value }), new RegExp(name))
  }
})

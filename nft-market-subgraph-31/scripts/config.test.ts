import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConfig } from './configure.ts'

const market = '0x1234567890123456789012345678901234567890'

// 合法配置不损失区块精度，且只产生公开参数。
test('接受 Sepolia 与本地配置', () => {
  assert.deepEqual(parseConfig(['sepolia', market, '123']), {
    network: 'sepolia',
    address: market,
    block: '123',
  })
  assert.equal(parseConfig(['local', market, '1']).network, 'local')
})

// 拒绝错误网络、地址、截断区块及多余参数，避免部署到意外目标。
test('拒绝不安全或无效参数', () => {
  for (const args of [
    [],
    ['mainnet', market, '1'],
    ['sepolia', '0x123', '1'],
    ['sepolia', `0x${'0'.repeat(40)}`, '1'],
    ['sepolia', market, '0'],
    ['sepolia', market, '-1'],
    ['sepolia', market, '1e3'],
    ['sepolia', market, '1.2'],
    ['sepolia', market, '9007199254740992'],
    ['sepolia', market, '1', 'extra'],
  ]) {
    assert.throws(() => parseConfig(args))
  }
})

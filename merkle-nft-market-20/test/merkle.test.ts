import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeAbiParameters, keccak256, zeroAddress } from 'viem'
import { buildMerkleTree } from '../src/merkle.ts'

const alice = '0x0000000000000000000000000000000000000001'

// 单地址根就是双哈希叶子，证明为空；固定编码独立验证 Solidity abi.encode 的格式。
test('one address produces the Solidity double-hashed leaf and an empty proof', () => {
  const tree = buildMerkleTree([alice])
  const leaf = keccak256(
    keccak256(encodeAbiParameters([{ type: 'address' }], [alice])),
  )
  assert.equal(tree.root, leaf)
  assert.deepEqual(tree.entries, [{ address: alice, proof: [] }])
})

// 边界输入必须在构建前失败，重复地址不应产生含糊的白名单记录。
test('rejects empty, duplicate, zero and malformed addresses', () => {
  for (const addresses of [[], [alice, alice], [zeroAddress], ['invalid']]) {
    assert.throws(() => buildMerkleTree(addresses))
  }
})

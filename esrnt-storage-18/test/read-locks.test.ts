import assert from 'node:assert/strict'
import test from 'node:test'
import { createPublicClient, custom, type Hex, keccak256, toHex } from 'viem'
import { readLocks } from '../src/read-locks.ts'

const target = '0x0000000000000000000000000000000000000018'
const base = BigInt(keccak256(toHex(0n, { size: 32 })))

/** 构造受控 RPC，校验所有读取固定在区块 42，并让缺失槽原样返回 undefined。 */
function storageClient(words: Map<string, Hex>, code: Hex = '0x00') {
  return createPublicClient({
    transport: custom(
      {
        /** 模拟只读 RPC；请求地址、区块或方法错误直接使测试失败。 */
        async request({
          method,
          params,
        }: {
          method: string
          params?: readonly unknown[]
        }) {
          assert.equal(params?.[0], target)
          if (method === 'eth_getCode') {
            assert.equal(params?.[1], '0x2a')
            return code
          }
          assert.equal(method, 'eth_getStorageAt')
          assert.equal(params?.[2], '0x2a')
          assert.equal(typeof params?.[1], 'string')
          return words.get(String(params?.[1]))
        },
      },
      { retryCount: 0 },
    ),
  })
}

// 使用两项而非硬编码 11，验证按链上长度遍历；极大整数与非零填充检验掩码和精度。
test('读取全部元素并正确处理紧凑布局、两槽步长和大整数', async () => {
  const user = '0x1234567890123456789012345678901234567890'
  const time = (1n << 64n) - 1n
  const amount = (1n << 256n) - 1n
  const words = new Map<string, Hex>([
    [toHex(0n, { size: 32 }), toHex(2n, { size: 32 })],
    [
      toHex(base, { size: 32 }),
      toHex((0xabcdef01n << 224n) | (time << 160n) | BigInt(user), {
        size: 32,
      }),
    ],
    [toHex(base + 1n, { size: 32 }), toHex(amount, { size: 32 })],
    [toHex(base + 2n, { size: 32 }), toHex((7n << 160n) | 2n, { size: 32 })],
    [toHex(base + 3n, { size: 32 }), toHex(0n, { size: 32 })],
  ])
  assert.deepEqual(await readLocks(storageClient(words), target, 42n), [
    { user, startTime: time, amount },
    { user: toHex(2n, { size: 20 }), startTime: 7n, amount: 0n },
  ])
})

// 真正的零长度合法；无代码、缺失/短响应与错误输入必须拒绝，不能产生伪造记录。
test('区分空数组、无效目标与不完整 RPC 响应', async () => {
  const words = new Map<string, Hex>([
    [toHex(0n, { size: 32 }), toHex(0n, { size: 32 })],
  ])
  assert.deepEqual(await readLocks(storageClient(words), target, 42n), [])
  await assert.rejects(
    readLocks(storageClient(words, '0x'), target, 42n),
    /没有合约代码/,
  )
  await assert.rejects(
    readLocks(storageClient(new Map()), target, 42n),
    /32 字节/,
  )
  words.set(toHex(0n, { size: 32 }), '0x00')
  await assert.rejects(readLocks(storageClient(words), target, 42n), /32 字节/)
  await assert.rejects(
    readLocks(storageClient(words), 'bad-address', 42n),
    /有效地址/,
  )
  await assert.rejects(readLocks(storageClient(words), target, -1n), /必须非负/)
})

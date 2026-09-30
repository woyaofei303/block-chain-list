import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeFunctionData, maxUint256, zeroAddress } from 'viem'
import { encodePurchase, marketAbi } from '../src/client.ts'

const market = '0x0000000000000000000000000000000000000020'

// 足额购物车无需签名；多件只调用旧合约已有的 multicall/claimNFT，不依赖新批量 ABI。
test('existing allowance selects single or batch settlement without permit', () => {
  const first = { tokenId: 0n, maxPayment: 1n }
  const second = { tokenId: 1n, maxPayment: 2n }
  const single = encodePurchase({
    market,
    items: [first],
    proof: [],
    allowance: 1n,
  })
  assert.equal(
    decodeFunctionData({ abi: marketAbi, data: single.data }).functionName,
    'claimNFT',
  )
  const batch = encodePurchase({
    market,
    items: [first, second],
    proof: [],
    allowance: 3n,
  })
  const decoded = decodeFunctionData({ abi: marketAbi, data: batch.data })
  assert.equal(decoded.functionName, 'multicall')
  assert.ok(decoded.functionName === 'multicall')
  assert.deepEqual(
    // 每个子调用保留自己的 tokenId 和预算；proof 在旧合约中逐次验证。
    decoded.args[0].map((data) => decodeFunctionData({ abi: marketAbi, data })),
    [
      { functionName: 'claimNFT', args: [0n, 1n, []] },
      { functionName: 'claimNFT', args: [1n, 2n, []] },
    ],
  )
  assert.throws(
    () =>
      encodePurchase({
        market,
        items: [first, second],
        proof: [],
        allowance: 2n,
      }),
    /需要 Permit/,
  )
})

// 编码前拒绝重复商品、空输入和金额越界，不允许 bigint 溢出或无效 proof 进入钱包签名流程。
test('purchase encoding rejects invalid cart and amounts', () => {
  const valid = {
    market,
    items: [{ tokenId: 0n, maxPayment: 1n }],
    proof: [],
    allowance: 1n,
  } as const
  assert.throws(() => encodePurchase({ ...valid, items: [] }), /不能为空/)
  assert.throws(
    () => encodePurchase({ ...valid, items: [valid.items[0], valid.items[0]] }),
    /重复/,
  )
  assert.throws(
    () =>
      encodePurchase({ ...valid, items: [{ tokenId: -1n, maxPayment: 1n }] }),
    /tokenId/,
  )
  assert.throws(
    () =>
      encodePurchase({ ...valid, items: [{ tokenId: 0n, maxPayment: 0n }] }),
    /预算/,
  )
  assert.throws(
    () =>
      encodePurchase({
        ...valid,
        items: [
          { tokenId: 0n, maxPayment: maxUint256 },
          { tokenId: 1n, maxPayment: 1n },
        ],
      }),
    /总预算/,
  )
  assert.throws(() => encodePurchase({ ...valid, allowance: -1n }), /allowance/)
  assert.throws(
    () => encodePurchase({ ...valid, market: zeroAddress }),
    /零地址/,
  )
  assert.throws(() => encodePurchase({ ...valid, proof: ['0x01'] }), /proof/)
})

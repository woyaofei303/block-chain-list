import {
  Address,
  Bytes,
  ethereum,
  BigInt as GraphBigInt,
} from '@graphprotocol/graph-ts'
import {
  afterEach,
  assert,
  clearStore,
  createMockedFunction,
  newMockEvent,
  test,
} from 'matchstick-as/assembly/index'
import { NFTListed, NFTSold } from '../generated/NFTMarket/NFTMarket'
import { handleListed, handleSold } from '../src/mapping'

const MARKET = Address.fromString('0x0000000000000000000000000000000000000001')
const NFT = Address.fromString('0x0000000000000000000000000000000000000002')
const TOKEN = Address.fromString('0x0000000000000000000000000000000000000003')
const SELLER = Address.fromString('0x0000000000000000000000000000000000000004')
const BUYER = Address.fromString('0x0000000000000000000000000000000000000005')
const HASH = Bytes.fromHexString(
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
)

// 每个用例清空实体，避免前一用例的当前挂单掩盖缺失事件。
afterEach(() => {
  clearStore()
})

/** 构造真实 ABI 形状的上架事件，同时模拟市场只读配置与可选 tokenURI。 */
function listed(
  index: i32,
  price: i32 = 100,
  seller: Address = SELLER,
  token: string = '1',
  revertURI: bool = false,
): NFTListed {
  const event = changetype<NFTListed>(newMockEvent())
  event.address = MARKET
  event.transaction.hash = HASH
  event.logIndex = GraphBigInt.fromI32(index)
  event.block.number = GraphBigInt.fromI32(1)
  event.parameters = [
    new ethereum.EventParam('seller', ethereum.Value.fromAddress(seller)),
    new ethereum.EventParam(
      'tokenId',
      ethereum.Value.fromUnsignedBigInt(GraphBigInt.fromString(token)),
    ),
    new ethereum.EventParam(
      'price',
      ethereum.Value.fromUnsignedBigInt(GraphBigInt.fromI32(price)),
    ),
  ]
  createMockedFunction(MARKET, 'nft', 'nft():(address)').returns([
    ethereum.Value.fromAddress(NFT),
  ])
  createMockedFunction(
    MARKET,
    'paymentToken',
    'paymentToken():(address)',
  ).returns([ethereum.Value.fromAddress(TOKEN)])
  const uri = createMockedFunction(
    NFT,
    'tokenURI',
    'tokenURI(uint256):(string)',
  ).withArgs([ethereum.Value.fromUnsignedBigInt(GraphBigInt.fromString(token))])
  if (revertURI) {
    uri.reverts()
  } else {
    uri.returns([ethereum.Value.fromString('ipfs://example/1.json')])
  }
  return event
}

/** 构造成交事件；日志序号独立于 tokenId，支持同一交易内多次成交。 */
function sold(
  index: i32,
  price: i32 = 100,
  seller: Address = SELLER,
  token: string = '1',
): NFTSold {
  const event = changetype<NFTSold>(newMockEvent())
  event.address = MARKET
  event.transaction.hash = HASH
  event.logIndex = GraphBigInt.fromI32(index)
  event.block.number = GraphBigInt.fromI32(1)
  event.parameters = [
    new ethereum.EventParam('seller', ethereum.Value.fromAddress(seller)),
    new ethereum.EventParam('buyer', ethereum.Value.fromAddress(BUYER)),
    new ethereum.EventParam(
      'tokenId',
      ethereum.Value.fromUnsignedBigInt(GraphBigInt.fromString(token)),
    ),
    new ethereum.EventParam(
      'price',
      ethereum.Value.fromUnsignedBigInt(GraphBigInt.fromI32(price)),
    ),
  ]
  return event
}

// 普通成交保留上架信息，并更新跨区块可变字段与正反关联。
test('sale links to listing and clears active pointer', () => {
  handleListed(listed(0))
  const sale = sold(1)
  sale.block.number = GraphBigInt.fromI32(2)
  sale.transaction.hash = Bytes.fromHexString(
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  )
  handleSold(sale)
  const id = HASH.concatI32(0).toHexString()
  assert.fieldEquals('List', id, 'status', 'SOLD')
  assert.fieldEquals('List', id, 'tokenURL', 'ipfs://example/1.json')
  assert.fieldEquals(
    'List',
    id,
    'filledTxHash',
    sale.transaction.hash.toHexString(),
  )
  assert.fieldEquals(
    'Sold',
    sale.transaction.hash.concatI32(1).toHexString(),
    'list',
    id,
  )
  assert.fieldEquals(
    'Sold',
    sale.transaction.hash.concatI32(1).toHexString(),
    'fee',
    '0',
  )
  assert.entityCount('ActiveListing', 0)
})

// 改价和再次出售不能覆盖历史实体，同一交易的日志也必须有独立 ID。
test('reprice and resale preserve distinct histories', () => {
  handleListed(listed(0))
  handleListed(listed(1, 120))
  handleSold(sold(2, 120))
  handleListed(listed(3, 150, BUYER))
  handleSold(sold(4, 150, BUYER))
  assert.entityCount('List', 3)
  assert.entityCount('Sold', 2)
  assert.fieldEquals(
    'List',
    HASH.concatI32(0).toHexString(),
    'status',
    'REPLACED',
  )
  assert.fieldEquals(
    'Sold',
    HASH.concatI32(2).toHexString(),
    'list',
    HASH.concatI32(1).toHexString(),
  )
  assert.fieldEquals(
    'Sold',
    HASH.concatI32(4).toHexString(),
    'list',
    HASH.concatI32(3).toHexString(),
  )
})

// 超过 32 位的 NFT 编号不能与编号 1 共用当前挂单。
test('large token ids do not collide', () => {
  handleListed(listed(0))
  handleListed(listed(1, 200, SELLER, '4294967297'))
  handleSold(sold(2, 200, SELLER, '4294967297'))
  assert.fieldEquals(
    'List',
    HASH.concatI32(0).toHexString(),
    'status',
    'LISTED',
  )
  assert.fieldEquals(
    'Sold',
    HASH.concatI32(2).toHexString(),
    'list',
    HASH.concatI32(1).toHexString(),
  )
  assert.entityCount('ActiveListing', 1)
})

// 可选元数据回滚仍须保存事件；缺失 URI 不能伪造为有效链接。
test('tokenURI revert does not stop indexing', () => {
  handleListed(listed(0, 100, SELLER, '1', true))
  assert.entityCount('List', 1)
  assert.fieldEquals(
    'List',
    HASH.concatI32(0).toHexString(),
    'tokenURL',
    'null',
  )
})

// 错误 startBlock 导致缺失上架时必须显式失败，不能产生无关联成交。
test(
  'orphan sale fails',
  () => {
    handleSold(sold(1))
  },
  true,
)

// ABI 或索引状态不匹配时停止索引，避免把成交错误地连到另一个报价。
test(
  'mismatched price fails',
  () => {
    handleListed(listed(0))
    handleSold(sold(1, 999))
  },
  true,
)

// 同一个挂单只能消费一次；重复成交必须发现而不是复用旧关联。
test(
  'second sale without relisting fails',
  () => {
    handleListed(listed(0))
    handleSold(sold(1))
    handleSold(sold(2))
  },
  true,
)

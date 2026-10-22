import { BigInt as GraphBigInt, store } from '@graphprotocol/graph-ts'
import { ERC721 } from '../generated/NFTMarket/ERC721'
import { NFTListed, NFTMarket, NFTSold } from '../generated/NFTMarket/NFTMarket'
import { ActiveListing, List, Sold } from '../generated/schema'

/** 保留完整 uint256 编号，避免不同 NFT 因转为 i32 而撞号。 */
function activeId(market: string, tokenId: GraphBigInt): string {
  return `${market}-${tokenId.toString()}`
}

/** 每条上架日志建立历史记录；改价只替换当前指针，保留旧报价。 */
export function handleListed(event: NFTListed): void {
  const key = activeId(event.address.toHexString(), event.params.tokenId)
  let active = ActiveListing.load(key)
  if (active != null) {
    const previous = List.load(active.list)
    if (previous == null) {
      assert(false, `Active listing missing: ${key}`)
      return
    }
    previous.status = 'REPLACED'
    previous.save()
  } else {
    active = new ActiveListing(key)
  }

  const market = NFTMarket.bind(event.address)
  const nft = market.nft()
  const listing = new List(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  listing.market = event.address
  listing.nft = nft
  listing.tokenId = event.params.tokenId
  // tokenURI 是可选接口；不存在或回滚时保留 null，不让元数据中断买卖索引。
  const uri = ERC721.bind(nft).try_tokenURI(event.params.tokenId)
  listing.tokenURL = uri.reverted ? null : uri.value
  listing.seller = event.params.seller
  listing.payToken = market.paymentToken()
  listing.price = event.params.price
  listing.deadline = GraphBigInt.zero()
  listing.blockNumber = event.block.number
  listing.blockTimestamp = event.block.timestamp
  listing.transactionHash = event.transaction.hash
  listing.logIndex = event.logIndex
  listing.status = 'LISTED'
  listing.save()
  active.list = listing.id
  active.save()
}

/** 成交必须匹配当时的挂单；缺失关联直接报错，提示检查 ABI 与起始区块。 */
export function handleSold(event: NFTSold): void {
  const key = activeId(event.address.toHexString(), event.params.tokenId)
  const active = ActiveListing.load(key)
  if (active == null) {
    assert(false, `Sale without listing; check startBlock: ${key}`)
    return
  }
  const listing = List.load(active.list)
  if (listing == null) {
    assert(false, `Active listing missing: ${key}`)
    return
  }
  if (
    listing.status != 'LISTED' ||
    !listing.seller.equals(event.params.seller) ||
    !listing.price.equals(event.params.price)
  ) {
    assert(false, `Sale does not match listing: ${key}`)
    return
  }

  const sale = new Sold(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  )
  sale.buyer = event.params.buyer
  sale.fee = GraphBigInt.zero()
  sale.price = event.params.price
  sale.blockNumber = event.block.number
  sale.blockTimestamp = event.block.timestamp
  sale.transactionHash = event.transaction.hash
  sale.logIndex = event.logIndex
  sale.list = listing.id
  sale.save()
  listing.status = 'SOLD'
  listing.filledTxHash = event.transaction.hash
  listing.save()
  store.remove('ActiveListing', key)
}

import type { Address } from "viem"

/** 按 PermitNFTMarket 的类型顺序构造白名单签名内容，绑定链、市场、买卖双方、NFT、价格及有效期，不能拿到另一市场重用。 */
export function whitelistTypedData(
  chainId: number,
  market: Address,
  buyer: Address,
  seller: Address,
  tokenId: bigint,
  price: bigint,
  nonce: bigint,
  deadline: bigint
) {
  return {
    domain: { name: "Julian NFT Market", version: "1", chainId, verifyingContract: market },
    primaryType: "Whitelist",
    types: {
      Whitelist: [
        { name: "buyer", type: "address" },
        { name: "seller", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "price", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: { buyer, seller, tokenId, price, nonce, deadline },
  } as const
}

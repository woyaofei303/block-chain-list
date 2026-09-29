import {
  type Address,
  encodeFunctionData,
  type Hex,
  parseAbi,
  parseSignature,
} from 'viem'

export const marketAbi = parseAbi([
  'function paymentToken() view returns (address)',
  'function nft() view returns (address)',
  'function merkleRoot() view returns (bytes32)',
  'function isWhitelisted(address account, bytes32[] proof) view returns (bool)',
  'function listings(uint256 tokenId) view returns (address seller, uint256 price)',
  'function list(uint256 tokenId, uint256 price)',
  'function permitPrePay(uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function claimNFT(uint256 tokenId, uint256 maxPayment, bytes32[] proof)',
  'function multicall(bytes[] data) returns (bytes[] results)',
])

export const tokenAbi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function nonces(address owner) view returns (uint256)',
])

export const nftAbi = parseAbi([
  'function mint(address to) returns (uint256)',
  'function nextTokenId() view returns (uint256)',
  'function owner() view returns (address)',
  'function approve(address spender, uint256 tokenId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
])

/** 为本项目 PermitToken 构造 EIP-2612 签名内容；nonce 从 Token 读取，金额保持 bigint。 */
export function permitTypedData(input: {
  token: Address
  chainId: number
  owner: Address
  market: Address
  value: bigint
  nonce: bigint
  deadline: bigint
}) {
  return {
    domain: {
      name: 'Merkle Market Token',
      version: '1',
      chainId: input.chainId,
      verifyingContract: input.token,
    },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: {
      owner: input.owner,
      spender: input.market,
      value: input.value,
      nonce: input.nonce,
      deadline: input.deadline,
    },
  } as const
}

/** 将钱包签名封装为一笔市场交易；先 Permit 再 claim，不是 Viem 的只读 multicall。 */
export function encodePermitClaim(input: {
  market: Address
  tokenId: bigint
  value: bigint
  deadline: bigint
  signature: Hex
  proof: readonly Hex[]
}) {
  const { r, s, yParity } = parseSignature(input.signature)
  const calls = [
    encodeFunctionData({
      abi: marketAbi,
      functionName: 'permitPrePay',
      args: [input.value, input.deadline, 27 + yParity, r, s],
    }),
    encodeFunctionData({
      abi: marketAbi,
      functionName: 'claimNFT',
      args: [input.tokenId, input.value, input.proof],
    }),
  ]
  return {
    to: input.market,
    data: encodeFunctionData({
      abi: marketAbi,
      functionName: 'multicall',
      args: [calls],
    }),
  }
}

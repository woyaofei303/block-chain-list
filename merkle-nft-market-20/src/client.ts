import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  isHex,
  maxUint256,
  type PublicClient,
  parseAbi,
  parseSignature,
  type WalletClient,
  zeroAddress,
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
  'function approve(address spender, uint256 amount) returns (bool)',
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

export type PurchaseItem = { tokenId: bigint; maxPayment: bigint }

/** 校验不可信购物车，拒绝重复编号、非 uint256 金额及总预算溢出；所有金额保持 bigint。 */
function purchaseTotal(items: readonly PurchaseItem[]) {
  if (items.length === 0) throw new Error('购物车不能为空')
  const ids = new Set<bigint>()
  let total = 0n
  for (const { tokenId, maxPayment } of items) {
    if (typeof tokenId !== 'bigint' || tokenId < 0n || tokenId > maxUint256) {
      throw new Error('无效 tokenId')
    }
    if (ids.has(tokenId)) throw new Error('重复 tokenId')
    ids.add(tokenId)
    if (
      typeof maxPayment !== 'bigint' ||
      maxPayment <= 0n ||
      maxPayment > maxUint256
    ) {
      throw new Error('无效购买预算')
    }
    total += maxPayment
    if (total > maxUint256) throw new Error('总预算超出 uint256')
  }
  return total
}

/** 复用旧合约编码购买：多件通过 multicall 逐项 claim，额度不足才加入一次总预算 Permit。 */
export function encodePurchase(input: {
  market: Address
  items: readonly PurchaseItem[]
  proof: readonly Hex[]
  allowance: bigint
  permit?: { deadline: bigint; signature: Hex }
}) {
  const value = purchaseTotal(input.items)
  const market = getAddress(input.market)
  if (market === zeroAddress) throw new Error('市场不能为零地址')
  if (
    typeof input.allowance !== 'bigint' ||
    input.allowance < 0n ||
    input.allowance > maxUint256
  ) {
    throw new Error('无效 allowance')
  }
  for (const node of input.proof) {
    if (!isHex(node, { strict: true }) || node.length !== 66)
      throw new Error('无效 Merkle proof')
  }
  // 每项金额由旧 claimNFT 重新校验；只合并交易和 Permit，不信任链下计算的成交总额。
  const calls = input.items.map((item) =>
    encodeFunctionData({
      abi: marketAbi,
      functionName: 'claimNFT',
      args: [item.tokenId, item.maxPayment, input.proof],
    }),
  )
  if (input.allowance < value) {
    const permit = input.permit
    if (!permit) throw new Error('额度不足，需要 Permit 签名')
    if (
      typeof permit.deadline !== 'bigint' ||
      permit.deadline < 0n ||
      permit.deadline > maxUint256
    ) {
      throw new Error('无效 Permit deadline')
    }
    const { r, s, yParity } = parseSignature(permit.signature)
    calls.unshift(
      encodeFunctionData({
        abi: marketAbi,
        functionName: 'permitPrePay',
        args: [value, permit.deadline, 27 + yParity, r, s],
      }),
    )
  }
  return {
    to: market,
    data:
      calls.length === 1
        ? calls[0]
        : encodeFunctionData({
            abi: marketAbi,
            functionName: 'multicall',
            args: [calls],
          }),
  }
}

/** 读取实际 allowance；不足时请求精确购物预算的离线签名，模拟后返回待发送交易，不自动广播。 */
export async function preparePurchase(input: {
  publicClient: PublicClient
  wallet: WalletClient
  buyer: Address
  market: Address
  items: readonly PurchaseItem[]
  proof: readonly Hex[]
}) {
  const value = purchaseTotal(input.items)
  const buyer = getAddress(input.buyer)
  const market = getAddress(input.market)
  if (buyer === zeroAddress || market === zeroAddress)
    throw new Error('买家和市场不能为零地址')
  // 提前验证 proof/购物车；输入无效时不弹出钱包签名请求。
  const withoutPermit = encodePurchase({
    market,
    items: input.items,
    proof: input.proof,
    allowance: value,
  })
  const chainId = await input.publicClient.getChainId()
  if (chainId !== (await input.wallet.getChainId()))
    throw new Error('钱包与读取 RPC 的链不一致')
  const token = await input.publicClient.readContract({
    address: market,
    abi: marketAbi,
    functionName: 'paymentToken',
  })
  const allowance = await input.publicClient.readContract({
    address: token,
    abi: tokenAbi,
    functionName: 'allowance',
    args: [buyer, market],
  })
  let permit: { deadline: bigint; signature: Hex } | undefined
  if (allowance < value) {
    const nonce = await input.publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: 'nonces',
      args: [buyer],
    })
    const deadline = (await input.publicClient.getBlock()).timestamp + 3_600n
    const signature = await input.wallet.signTypedData({
      account: buyer,
      ...permitTypedData({
        token,
        chainId,
        owner: buyer,
        market,
        value,
        nonce,
        deadline,
      }),
    })
    permit = { deadline, signature }
  }
  const call = permit
    ? encodePurchase({
        market,
        items: input.items,
        proof: input.proof,
        allowance,
        permit,
      })
    : withoutPermit
  await input.publicClient.call({ account: buyer, ...call })
  return call
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

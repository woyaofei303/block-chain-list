import assert from 'node:assert/strict'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  getAddress,
  type Hash,
  http,
  parseEther,
  zeroAddress,
} from 'viem'
import { anvil } from 'viem/chains'
import {
  encodePermitClaim,
  marketAbi,
  nftAbi,
  permitTypedData,
  tokenAbi,
} from '../src/client.ts'
import { buildMerkleTree } from '../src/merkle.ts'

/** 在全新本地部署上完成铸造、分币、上架、签名和一笔购买；仅使用 Anvil RPC 解锁账户。 */
export async function runDemo(rpcUrl: string, marketAddress: string) {
  const url = new URL(rpcUrl)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('演示只允许本机 HTTP Anvil RPC')
  }
  const market = getAddress(marketAddress)
  const publicClient = createPublicClient({
    chain: anvil,
    transport: http(rpcUrl),
  })
  const wallet = createWalletClient({ chain: anvil, transport: http(rpcUrl) })
  assert.equal(
    await publicClient.getChainId(),
    31337,
    '仅允许本地 chain ID 31337',
  )
  const accounts = await wallet.getAddresses()
  assert.ok(accounts.length >= 4, '需要 Anvil 的前四个解锁账户')
  const [seller, buyer] = accounts
  const tree = buildMerkleTree(accounts.slice(1, 4))
  const proof = tree.entries[0].proof
  const token = await publicClient.readContract({
    address: market,
    abi: marketAbi,
    functionName: 'paymentToken',
  })
  const nft = await publicClient.readContract({
    address: market,
    abi: marketAbi,
    functionName: 'nft',
  })
  const root = await publicClient.readContract({
    address: market,
    abi: marketAbi,
    functionName: 'merkleRoot',
  })
  assert.equal(root, tree.root, '部署根必须由 RPC 账户 1、2、3 按此顺序构建')
  assert.equal(
    await publicClient.readContract({
      address: nft,
      abi: nftAbi,
      functionName: 'nextTokenId',
    }),
    0n,
    '本演示只用于全新部署；已有 NFT 时停止，避免重复铸造或充值',
  )
  assert.equal(
    getAddress(
      await publicClient.readContract({
        address: nft,
        abi: nftAbi,
        functionName: 'owner',
      }),
    ),
    getAddress(seller),
  )

  /** 每步等待成功回执后再继续；RPC 返回交易哈希不等于交易已经成功。 */
  async function confirmed(hash: Hash) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    assert.equal(receipt.status, 'success', `交易失败：${hash}`)
    return receipt
  }

  /** 读取指定账户的 Token 余额，保留 bigint 精度。 */
  async function balanceOf(account: Address) {
    return publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [account],
    })
  }

  await confirmed(
    await wallet.writeContract({
      account: seller,
      address: nft,
      abi: nftAbi,
      functionName: 'mint',
      args: [seller],
    }),
  )
  await confirmed(
    await wallet.writeContract({
      account: seller,
      address: token,
      abi: tokenAbi,
      functionName: 'transfer',
      args: [buyer, parseEther('100')],
    }),
  )
  await confirmed(
    await wallet.writeContract({
      account: seller,
      address: nft,
      abi: nftAbi,
      functionName: 'approve',
      args: [market, 0n],
    }),
  )
  await confirmed(
    await wallet.writeContract({
      account: seller,
      address: market,
      abi: marketAbi,
      functionName: 'list',
      args: [0n, parseEther('100')],
    }),
  )

  const before = {
    buyer: await balanceOf(buyer),
    seller: await balanceOf(seller),
  }
  const nonce = await publicClient.readContract({
    address: token,
    abi: tokenAbi,
    functionName: 'nonces',
    args: [buyer],
  })
  assert.equal(
    await publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: 'allowance',
      args: [buyer, market],
    }),
    0n,
  )
  const value = parseEther('50')
  const deadline = (await publicClient.getBlock()).timestamp + 3_600n
  // RPC 钱包完成本地 EIP-712 签名，不取出密钥；真实钱包可使用相同 typed data。
  const signature = await wallet.signTypedData({
    account: buyer,
    ...permitTypedData({
      token,
      chainId: 31337,
      owner: buyer,
      market,
      value,
      nonce,
      deadline,
    }),
  })
  const call = encodePermitClaim({
    market,
    tokenId: 0n,
    value,
    deadline,
    signature,
    proof,
  })
  // eth_call 模拟不会消费链上 nonce；随后发送的唯一购买交易调用市场自身 multicall。
  await publicClient.call({ account: buyer, ...call })
  const receipt = await confirmed(
    await wallet.sendTransaction({ account: buyer, ...call }),
  )
  const after = {
    buyer: await balanceOf(buyer),
    seller: await balanceOf(seller),
    market: await balanceOf(market),
    owner: await publicClient.readContract({
      address: nft,
      abi: nftAbi,
      functionName: 'ownerOf',
      args: [0n],
    }),
    nonce: await publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: 'nonces',
      args: [buyer],
    }),
    allowance: await publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: 'allowance',
      args: [buyer, market],
    }),
    listing: await publicClient.readContract({
      address: market,
      abi: marketAbi,
      functionName: 'listings',
      args: [0n],
    }),
  }
  assert.equal(after.buyer, before.buyer - value)
  assert.equal(after.seller, before.seller + value)
  assert.equal(after.market, 0n)
  assert.equal(getAddress(after.owner), getAddress(buyer))
  assert.equal(after.nonce, nonce + 1n)
  assert.equal(after.allowance, 0n)
  assert.deepEqual(after.listing, [zeroAddress, 0n])
  return {
    market,
    token,
    nft,
    seller,
    buyer,
    root,
    transactionHash: receipt.transactionHash,
    gasUsed: receipt.gasUsed,
    before,
    after,
  }
}

// CLI 显式要求 RPC 和市场地址；仅打印公开结果，bigint 序列化为十进制字符串。
if (import.meta.main) {
  const [, , rpcUrl, market] = process.argv
  if (!rpcUrl || !market)
    throw new Error(
      '用法：npm run demo -- http://127.0.0.1:8549 MARKET_ADDRESS',
    )
  console.log(
    JSON.stringify(
      await runDemo(rpcUrl, market),
      (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      2,
    ),
  )
}

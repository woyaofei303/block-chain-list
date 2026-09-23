import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import test from "node:test"
import { setTimeout } from "node:timers/promises"
import {
  createPublicClient,
  type EIP1193Provider,
  erc721Abi,
  getAddress,
  type Hash,
  http,
  numberToHex,
  parseEther,
  parseEventLogs,
  erc20Abi as tokenAbi,
} from "viem"
import { createBank } from "../domains/bank/client.ts"
import { deployPractice, marketAbi, nftAbi } from "../scripts/permit-local.ts"
import { whitelistTypedData } from "../scripts/whitelist.ts"

test("真实 RPC 签名：前端 Permit 存取款、拒签/切换保护、白名单 NFT 结算", {
  timeout: 90_000,
}, async (t) => {
  const server = createServer().listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address === "object")
  await new Promise<void>((done) => server.close(() => done()))
  const node = spawn("anvil", ["--host", "127.0.0.1", "--port", String(address.port), "--silent"], {
    stdio: "ignore",
  })
  t.after(async () => {
    if (node.exitCode === null && node.signalCode === null) {
      const stopped = once(node, "exit")
      node.kill()
      await stopped
    }
  })
  const url = `http://127.0.0.1:${address.port}`
  const rpc = createPublicClient({ transport: http(url, { retryCount: 0 }) })
  for (let attempt = 0; ; attempt++) {
    try {
      await rpc.getChainId()
      break
    } catch (error) {
      if (attempt >= 60) throw error
      await setTimeout(50)
    }
  }
  const { client, wallet, mined, seller, buyer, bank, token, nft, market } =
    await deployPractice(url)
  let selected = buyer
  let reject = false
  let switchAfterSign = false
  let wrongChain = false
  let writes = 0
  let abortAfterSign: AbortController | undefined
  // 测试钱包适配器：RPC 数据交给真实 Anvil，仅模拟用户拒签和账户切换。
  const provider = {
    async request(args: { method: string; params?: unknown }) {
      if (["eth_accounts", "eth_requestAccounts"].includes(args.method)) return [selected]
      if (args.method === "eth_chainId" && wrongChain) return "0x1"
      if (args.method === "eth_signTypedData_v4" && reject)
        throw Object.assign(new Error("User rejected signature"), { code: 4001 })
      if (args.method === "eth_sendTransaction") writes++
      const result = await rpc.request(args as Parameters<typeof rpc.request>[0])
      if (args.method === "eth_signTypedData_v4" && switchAfterSign) selected = seller
      if (args.method === "eth_signTypedData_v4") abortAfterSign?.abort()
      return result
    },
  } as EIP1193Provider
  const session = createBank(provider, 31337, bank, buyer)
  let sequence = 0
  const transactBank = (
    amount: string,
    action: "permit" | "deposit" | "withdraw",
    progress: (event: { hash?: Hash }) => void
  ) =>
    session
      .transact(
        action === "permit" ? "deposit" : action,
        amount,
        (_message, hash) => progress({ hash }),
        {
          id: numberToHex(++sequence, { size: 32 }),
          authorization: action === "permit" ? "permit" : "approve",
          onBroadcast: () => {},
        }
      )
      .then(() => session.read())
  const before = await session.read()
  assert.equal(before.permitSupported, true)
  const hashes: Hash[] = []
  const after = await transactBank("10.000000000000000001", "permit", (event) => {
    if (event.hash) hashes.push(event.hash)
  })
  assert.equal(writes, 1, "签名存款只能发送一笔交易，不调用 approve")
  assert.equal(after.deposited, parseEther("10.000000000000000001"))
  assert.equal(after.walletBalance, before.walletBalance - after.deposited)
  assert.equal(after.bankAssets, after.deposited)
  const depositReceipt = await client.getTransactionReceipt({ hash: hashes[0] })
  const depositTransfers = parseEventLogs({
    abi: tokenAbi,
    eventName: "Transfer",
    logs: depositReceipt.logs.filter((log) => log.address.toLowerCase() === token.toLowerCase()),
  })
  assert.deepEqual(
    depositTransfers.map((log) => log.args),
    [{ from: buyer, to: getAddress(bank), value: after.deposited }]
  )
  console.log("Permit deposit:", {
    token,
    from: buyer,
    to: bank,
    before: before.walletBalance.toString(),
    after: after.walletBalance.toString(),
    bank: after.bankAssets.toString(),
    hash: hashes[0],
  })
  reject = true
  await assert.rejects(
    transactBank("1", "permit", () => {}),
    /reject/i
  )
  reject = false
  switchAfterSign = true
  await assert.rejects(
    transactBank("1", "permit", () => {}),
    /已变化/
  )
  switchAfterSign = false
  selected = buyer
  wrongChain = true
  await assert.rejects(
    transactBank("1", "permit", () => {}),
    /网络不匹配/
  )
  wrongChain = false
  assert.equal(writes, 1, "拒签、切换后不得广播")
  abortAfterSign = new AbortController()
  const cancelledBank = createBank(provider, 31337, bank, buyer, () => true, abortAfterSign.signal)
  await assert.rejects(
    cancelledBank.transact("deposit", "1", () => {}, {
      id: numberToHex(900, { size: 32 }),
      authorization: "permit",
      onBroadcast: () => {},
    }),
    { name: "AbortError" }
  )
  abortAfterSign = undefined
  assert.equal(writes, 1, "签名返回后终止不得发送存款交易")
  await session.transact("deposit", "10.000000000000000001", () => {}, {
    id: numberToHex(1, { size: 32 }),
    authorization: "permit",
    onBroadcast: () => {},
  })
  assert.equal(writes, 1, "使用原编号恢复不得重复存款")
  const withdrawn = await transactBank("4", "withdraw", () => {})
  assert.equal(withdrawn.deposited, parseEther("6.000000000000000001"))
  await assert.rejects(
    transactBank("7", "withdraw", () => {}),
    /超过可用余额/
  )
  const ordinary = await transactBank("1", "deposit", () => {})
  assert.equal(ordinary.deposited, parseEther("7.000000000000000001"))

  const price = parseEther("100")
  const deadline = (await client.getBlock()).timestamp + 1200n
  const nonce = await client.readContract({
    address: market,
    abi: marketAbi,
    functionName: "nonces",
    args: [buyer],
  })
  const signature = await wallet.signTypedData({
    account: seller,
    ...whitelistTypedData(31337, market, buyer, seller, 0n, price, nonce, deadline),
  })
  await mined(
    await wallet.writeContract({
      account: buyer,
      address: token,
      abi: tokenAbi,
      functionName: "approve",
      args: [market, price],
    })
  )
  const beforeSeller = await client.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [seller],
  })
  const beforeBuyer = await client.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [buyer],
  })
  assert.equal(
    await client.readContract({ address: nft, abi: nftAbi, functionName: "ownerOf", args: [0n] }),
    seller
  )
  const purchase = await mined(
    await wallet.writeContract({
      account: buyer,
      address: market,
      abi: marketAbi,
      functionName: "permitBuy",
      args: [0n, deadline, signature],
    })
  )
  const owner = await client.readContract({
    address: nft,
    abi: nftAbi,
    functionName: "ownerOf",
    args: [0n],
  })
  assert.equal(owner, buyer)
  const paymentTransfers = parseEventLogs({
    abi: tokenAbi,
    eventName: "Transfer",
    logs: purchase.logs.filter((log) => log.address.toLowerCase() === token.toLowerCase()),
  })
  const nftTransfers = parseEventLogs({
    abi: erc721Abi,
    eventName: "Transfer",
    logs: purchase.logs.filter((log) => log.address.toLowerCase() === nft.toLowerCase()),
  })
  assert.deepEqual(
    paymentTransfers.map((log) => log.args),
    [{ from: buyer, to: seller, value: price }]
  )
  assert.deepEqual(
    nftTransfers.map((log) => log.args),
    [{ from: seller, to: buyer, tokenId: 0n }]
  )
  assert.equal(
    await client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [seller],
    }),
    beforeSeller + price
  )
  assert.equal(
    await client.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [buyer],
    }),
    beforeBuyer - price
  )
  assert.equal(
    await client.readContract({
      address: market,
      abi: marketAbi,
      functionName: "nonces",
      args: [buyer],
    }),
    1n
  )
  console.log("Whitelist purchase:", {
    nft: "Blocklight Genesis #0",
    from: seller,
    to: owner,
    payment: price.toString(),
    tokenTransfer: paymentTransfers[0].args,
    nftTransfer: nftTransfers[0].args,
    hash: purchase.transactionHash,
  })
})

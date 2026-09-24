import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { resolve } from "node:path"
import { test } from "node:test"
import { setTimeout } from "node:timers/promises"
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  type EIP1193Provider,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hash,
  http,
  numberToHex,
  parseAbi,
  parseEther,
} from "viem"
import { foundry } from "viem/chains"
import { createBank, METAMASK_DELEGATOR } from "../domains/bank/client.ts"

test("本地链完成授权、存款、取款，并在拒签及账户切换时停止", {
  timeout: 60_000,
}, async (t) => {
  const reservation = createServer().listen(0, "127.0.0.1")
  await once(reservation, "listening")
  const reserved = reservation.address()
  assert.ok(reserved && typeof reserved === "object")
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const anvil = spawn(
    "anvil",
    ["--port", String(reserved.port), "--hardfork", "prague", "--silent"],
    {
      stdio: "ignore",
    }
  )
  t.after(async () => {
    if (anvil.exitCode === null && anvil.signalCode === null) {
      const stopped = once(anvil, "exit")
      anvil.kill()
      await stopped
    }
  })
  const transport = http(`http://127.0.0.1:${reserved.port}`, { retryCount: 0 })
  const rpc = createPublicClient({
    transport,
    chain: foundry,
    pollingInterval: 20,
  })
  for (let attempt = 0; ; attempt++) {
    try {
      await rpc.getChainId()
      break
    } catch (error) {
      if (attempt >= 40) throw error
      await setTimeout(50)
    }
  }
  const wallet = createWalletClient({ transport, chain: foundry })
  const [account, other] = await wallet.getAddresses()
  const root = resolve(import.meta.dirname, "../../contracts")
  function bytecode(contract: string) {
    return execFileSync("forge", ["inspect", contract, "bytecode", "--root", root], {
      cwd: root,
      encoding: "utf8",
    }).trim() as `0x${string}`
  }
  const tokenTx = await wallet.deployContract({
    account,
    abi: [],
    bytecode: bytecode("src/BaseERC20.sol:BaseERC20"),
  })
  const tokenReceipt = await rpc.waitForTransactionReceipt({ hash: tokenTx })
  assert.ok(tokenReceipt.contractAddress)
  const bankTx = await wallet.deployContract({
    account,
    abi: parseAbi(["constructor(address tokenAddress,address permit2Address)"]),
    args: [tokenReceipt.contractAddress, "0x0000000000000000000000000000000000000000"],
    bytecode: bytecode("src/IdempotentTokenBank.sol:IdempotentTokenBank"),
  })
  const bankReceipt = await rpc.waitForTransactionReceipt({ hash: bankTx })
  assert.ok(bankReceipt.contractAddress)
  let selected = account
  let rejectSignature = false
  let cancelAfterBroadcast: AbortController | undefined
  let sends = 0
  const provider = {
    async request(args: { method: string; params?: unknown }) {
      if (args.method === "eth_accounts") return [selected]
      if (args.method === "eth_sendTransaction" && rejectSignature)
        throw Object.assign(new Error("User rejected"), { code: 4001 })
      const result = await rpc.request(args as Parameters<typeof rpc.request>[0])
      if (args.method === "eth_sendTransaction" && cancelAfterBroadcast) {
        sends++
        cancelAfterBroadcast.abort()
      }
      return result
    },
  } as EIP1193Provider
  const legacyReceipt = await rpc.waitForTransactionReceipt({
    hash: await wallet.deployContract({
      account,
      abi: parseAbi(["constructor(address tokenAddress)"]),
      args: [tokenReceipt.contractAddress],
      bytecode: bytecode("src/TokenBank.sol:TokenBank"),
    }),
  })
  assert.ok(legacyReceipt.contractAddress)
  const legacy = createBank(provider, 31337, legacyReceipt.contractAddress, account)
  assert.equal((await legacy.read()).idempotent, false)
  await assert.rejects(
    legacy.transact("deposit", "1", () => {}, {
      id: numberToHex(500, { size: 32 }),
      onBroadcast: () => {},
    }),
    /旧版/
  )
  const bankClient = createBank(provider, 31337, bankReceipt.contractAddress, account)
  let operationSequence = 0
  const bank = {
    read: bankClient.read,
    transact: (
      action: "deposit" | "withdraw",
      amount: string,
      progress: (message: string) => void
    ) =>
      bankClient.transact(action, amount, progress, {
        id: numberToHex(++operationSequence, { size: 32 }),
        onBroadcast: () => {},
      }),
  }
  const before = await bank.read()
  const progress: string[] = []
  await bank.transact("deposit", "10.000000000000000001", (message) => progress.push(message))
  const deposited = await bank.read()
  assert.equal(deposited.deposited, parseEther("10.000000000000000001"))
  assert.equal(deposited.bankAssets, deposited.deposited)
  assert.equal(deposited.walletBalance, before.walletBalance - deposited.deposited)
  assert.ok(progress.some((message) => message.startsWith("授权已提交")))
  const abort = new AbortController()
  let lateHash: string | undefined
  cancelAfterBroadcast = abort
  const cancelledBank = createBank(
    provider,
    31337,
    bankReceipt.contractAddress,
    account,
    () => true,
    abort.signal
  )
  await assert.rejects(
    cancelledBank.transact("deposit", "0.5", () => {}, {
      id: numberToHex(101, { size: 32 }),
      onBroadcast: (_stage, hash) => {
        lateHash = hash
      },
    }),
    { name: "AbortError" }
  )
  cancelAfterBroadcast = undefined
  assert.equal(sends, 1, "授权后终止不得继续存款")
  assert.ok(lateHash, "钱包晚返回的哈希必须保存")
  assert.equal((await bank.read()).deposited, deposited.deposited)
  selected = other
  const otherBank = createBank(provider, 31337, bankReceipt.contractAddress, other)
  const otherSnapshot = await otherBank.read()
  assert.equal(otherSnapshot.deposited, 0n)
  assert.equal(otherSnapshot.bankAssets, deposited.bankAssets)
  await assert.rejects(
    otherBank.transact("withdraw", "1", () => {}, {
      id: numberToHex(100, { size: 32 }),
      onBroadcast: () => {},
    }),
    /超过可用余额/
  )
  selected = account
  await bank.transact("withdraw", "4", () => {})
  assert.equal((await bank.read()).deposited, parseEther("6.000000000000000001"))
  await assert.rejects(
    bank.transact("withdraw", "7", () => {}),
    /超过可用余额/
  )
  rejectSignature = true
  await assert.rejects(bank.transact("withdraw", "1", () => {}))
  assert.equal((await bank.read()).deposited, parseEther("6.000000000000000001"))
  rejectSignature = false
  await assert.rejects(
    bank.transact("deposit", "1", (message) => {
      if (message.startsWith("授权已提交")) selected = other
    }),
    /账户已变化/
  )
  selected = account
  assert.equal((await bank.read()).deposited, parseEther("6.000000000000000001"))
  await assert.rejects(
    createBank(provider, 11155111, bankReceipt.contractAddress, account).read(),
    /网络不匹配/
  )
  await bank.transact("withdraw", "6.000000000000000001", () => {})
  assert.equal((await bank.read()).deposited, 0n)
  assert.equal((await bank.read()).walletBalance, before.walletBalance)
  assert.equal((await bank.read()).bankAssets, 0n)
  // 直接转入银行的代币属于合约总资产，但不会自动记成个人存款。
  const directTransfer = await wallet.writeContract({
    account,
    address: tokenReceipt.contractAddress,
    abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]),
    functionName: "transfer",
    args: [bankReceipt.contractAddress, parseEther("1")],
  })
  await rpc.waitForTransactionReceipt({ hash: directTransfer })
  const donated = await bank.read()
  assert.equal(donated.bankAssets, parseEther("1"))
  assert.equal(donated.deposited, 0n)

  await t.test(
    "官方 Delegator 字节码在隔离 Anvil 中单笔存款，失败时授权与账本整体回滚",
    {
      skip: !process.env.EIP7702_RPC_URL,
    },
    async () => {
      assert.ok(bankReceipt.contractAddress)
      assert.ok(tokenReceipt.contractAddress)
      // 公共 RPC 仅取官方已部署字节码。写入只使用上面随机端口的本地 Anvil。
      const source = createPublicClient({
        transport: http(process.env.EIP7702_RPC_URL, { retryCount: 0 }),
      })
      const code = await source.getCode({ address: METAMASK_DELEGATOR })
      assert.ok(code && code.length > 100)
      const local = createTestClient({ mode: "anvil", transport, chain: foundry })
      await local.setCode({ address: METAMASK_DELEGATOR, bytecode: code })
      await local.setCode({ address: account, bytecode: `0xef0100${METAMASK_DELEGATOR.slice(2)}` })
      let batchHash: Hash | undefined
      let breakDeposit = false
      const batchProvider = {
        async request(args: { method: string; params?: unknown }) {
          if (args.method === "wallet_getCapabilities")
            return { "0x7a69": { atomic: { status: "supported" } } }
          if (args.method === "wallet_sendCalls") {
            const [batch] = args.params as [
              { calls: { to: `0x${string}`; data: `0x${string}`; value: `0x${string}` }[] },
            ]
            const calls = batch.calls.map((call) => ({
              target: call.to,
              value: BigInt(call.value),
              callData: call.data,
            }))
            if (breakDeposit)
              calls[1].callData = encodeFunctionData({
                abi: parseAbi(["function deposit(uint256,bytes32)"]),
                functionName: "deposit",
                args: [parseEther("2"), numberToHex(7703, { size: 32 })],
              })
            batchHash = await wallet.writeContract({
              account,
              address: account,
              abi: parseAbi(["function execute(bytes32 mode, bytes executionCalldata) payable"]),
              functionName: "execute",
              args: [
                `0x01${"00".repeat(31)}`,
                encodeAbiParameters(
                  [
                    {
                      type: "tuple[]",
                      components: [
                        { name: "target", type: "address" },
                        { name: "value", type: "uint256" },
                        { name: "callData", type: "bytes" },
                      ],
                    },
                  ],
                  [calls]
                ),
              ],
              gas: 500_000n,
            })
            return { id: batchHash }
          }
          if (args.method === "wallet_getCallsStatus") {
            assert.ok(batchHash)
            const receipt = await rpc.request({
              method: "eth_getTransactionReceipt",
              params: [batchHash],
            })
            return {
              id: batchHash,
              version: "2.0.0",
              chainId: "0x7a69",
              atomic: true,
              status: !receipt ? 100 : receipt.status === "0x1" ? 200 : 500,
              receipts: receipt ? [receipt] : [],
            }
          }
          return provider.request(args as Parameters<typeof provider.request>[0])
        },
      } as EIP1193Provider
      const batched = createBank(batchProvider, 31337, bankReceipt.contractAddress, account)
      const beforeBatch = await batched.read()
      const nonce = await rpc.getTransactionCount({ address: account })
      const batchOperation = {
        id: numberToHex(7702, { size: 32 }),
        depositMode: "eip7702" as const,
        onBatchPending: () => {},
        onCallsId: () => {},
        onBroadcast: () => {},
      }
      const hash = await batched.transact(
        "deposit",
        "1.000000000000000001",
        () => {},
        batchOperation
      )
      assert.ok(hash)
      assert.equal(await rpc.getTransactionCount({ address: account }), nonce + 1)
      const afterBatch = await batched.read()
      assert.equal(afterBatch.deposited, beforeBatch.deposited + parseEther("1.000000000000000001"))
      assert.equal(
        afterBatch.walletBalance,
        beforeBatch.walletBalance - parseEther("1.000000000000000001")
      )
      const receipt = await rpc.getTransactionReceipt({ hash })
      assert.equal(receipt.logs.length, 3, "同一回执包含 Approval、Transfer、OperationExecuted")
      breakDeposit = true
      await assert.rejects(
        batched.transact("deposit", "1", () => {}, {
          ...batchOperation,
          id: numberToHex(7703, { size: 32 }),
        }),
        /回滚/
      )
      assert.deepEqual(await batched.read(), afterBatch)
      assert.equal(
        await rpc.readContract({
          address: tokenReceipt.contractAddress,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account, bankReceipt.contractAddress],
        }),
        0n,
        "失败批次的 approve 也必须回滚"
      )
    }
  )
})

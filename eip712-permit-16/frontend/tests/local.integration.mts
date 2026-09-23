import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { resolve } from "node:path"
import { test } from "node:test"
import { setTimeout } from "node:timers/promises"
import {
  createPublicClient,
  createWalletClient,
  type EIP1193Provider,
  http,
  numberToHex,
  parseAbi,
  parseEther,
} from "viem"
import { foundry } from "viem/chains"
import { createBank } from "../domains/bank/client.ts"

test("本地链完成授权、存款、取款，并在拒签及账户切换时停止", {
  timeout: 60_000,
}, async (t) => {
  const reservation = createServer().listen(0, "127.0.0.1")
  await once(reservation, "listening")
  const reserved = reservation.address()
  assert.ok(reserved && typeof reserved === "object")
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const anvil = spawn("anvil", ["--port", String(reserved.port), "--silent"], {
    stdio: "ignore",
  })
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
})

import assert from "node:assert/strict"
import { test } from "node:test"
import {
  decodeFunctionData,
  type EIP1193Provider,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  numberToHex,
  parseAbi,
  zeroHash,
} from "viem"
import { createBank } from "../domains/bank/client.ts"
import {
  executeIntent,
  type Intent,
  restoreIntent,
  saveIntent,
} from "../domains/operations/client.ts"

const account = `0x${"a".repeat(40)}` as const
const bank = `0x${"b".repeat(40)}` as const
const token = `0x${"c".repeat(40)}` as const
const delegator = "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B"
const delegation = `0xef0100${delegator.slice(2).toLowerCase()}`
const transactionHash = `0x${"d".repeat(64)}` as const
const operationId = numberToHex(1, { size: 32 })
const abi = parseAbi([
  "function token() view returns (address)",
  "function supportsPermit() view returns (bool)",
  "function permit2() view returns (address)",
  "function balances(address) view returns (uint256)",
  "function operationHash(address, bytes32) view returns (bytes32)",
  "function deposit(uint256, bytes32)",
])

function walletBoundary() {
  const requests: { method: string; params?: unknown }[] = []
  const receipt = {
    transactionHash,
    transactionIndex: "0x0",
    blockHash: zeroHash,
    blockNumber: "0x1",
    from: account,
    to: account,
    status: "0x1",
    gasUsed: "0x10000",
    cumulativeGasUsed: "0x10000",
    effectiveGasPrice: "0x1",
    logs: [],
    logsBloom: `0x${"0".repeat(512)}`,
    type: "0x4",
  }
  const state = {
    capability: "ready",
    code: "0x",
    implementationCode: "0x6000",
    status: 200,
    atomic: true,
    receipts: [receipt],
    chainId: "0xaa36a7",
    onSend: () => {},
    selected: account as string,
  }
  const provider = {
    async request(request: { method: string; params?: readonly unknown[] }) {
      requests.push(request)
      const params = request.params ?? []
      switch (request.method) {
        case "eth_chainId":
          return "0xaa36a7"
        case "eth_accounts":
          return [state.selected]
        case "eth_getCode":
          return String(params[0]).toLowerCase() === delegator.toLowerCase()
            ? state.implementationCode
            : state.code
        case "wallet_getCapabilities":
          return { "0xaa36a7": { atomic: { status: state.capability } } }
        case "wallet_sendCalls":
          state.onSend()
          state.code = delegation
          return { id: "batch-1" }
        case "wallet_getCallsStatus":
          return {
            id: "batch-1",
            version: "2.0.0",
            chainId: state.chainId,
            status: state.status,
            atomic: state.atomic,
            receipts: state.receipts,
          }
        case "eth_getTransactionReceipt":
          return receipt
        case "eth_call": {
          const call = params[0] as { to: string; data: `0x${string}` }
          const contractAbi = call.to.toLowerCase() === bank ? abi : erc20Abi
          const decoded = decodeFunctionData({ abi: contractAbi, data: call.data })
          const values: Record<string, string | number | bigint | boolean> = {
            token,
            supportsPermit: false,
            permit2: `0x${"0".repeat(40)}`,
            symbol: "TEST",
            decimals: 6,
            balanceOf: 20_000_000n,
            balances: 0n,
            operationHash: zeroHash,
          }
          return encodeFunctionResult({
            abi: contractAbi,
            functionName: decoded.functionName,
            result: values[decoded.functionName],
          })
        }
        default:
          throw new Error(`Unexpected RPC: ${request.method}`)
      }
    },
  } as EIP1193Provider
  const client = createBank(provider, 11155111, bank, account)
  const saved: string[] = []
  const operation = {
    id: operationId,
    depositMode: "eip7702" as const,
    onBatchPending: () => saved.push("pending"),
    onCallsId: (id: string) => saved.push(id),
    onBroadcast: (_stage: string, hash: string) => saved.push(hash),
  }
  return { requests, state, client, operation, saved, provider }
}

test("7702 存款一次 sendCalls 按序授权精确金额并存入，核实单笔回执及官方委托", async () => {
  const { client, operation, requests, saved } = walletBoundary()
  assert.equal(await client.transact("deposit", "1.000001", () => {}, operation), transactionHash)
  const sends = requests.filter((request) => request.method === "wallet_sendCalls")
  assert.equal(sends.length, 1)
  assert.equal(
    requests.some((request) => request.method === "eth_sendTransaction"),
    false
  )
  const [batch] = sends[0].params as [
    {
      version: string
      chainId: string
      from: string
      atomicRequired: boolean
      calls: { to: string; data: `0x${string}` }[]
    },
  ]
  assert.equal(batch.version, "2.0.0")
  assert.equal(batch.chainId, "0xaa36a7")
  assert.equal(batch.from, account)
  assert.equal(batch.atomicRequired, true)
  assert.deepEqual(
    batch.calls.map((call) => call.to.toLowerCase()),
    [token, bank]
  )
  assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: batch.calls[0].data }), {
    functionName: "approve",
    args: [getAddress(bank), 1_000_001n],
  })
  assert.deepEqual(decodeFunctionData({ abi, data: batch.calls[1].data }), {
    functionName: "deposit",
    args: [1_000_001n, operationId],
  })
  assert.deepEqual(saved, ["pending", "batch-1", transactionHash])
})

test("不支持原子批量、委托错误或官方合约缺失时，拒绝发送且不降级", async () => {
  for (const patch of [
    { capability: "unsupported" },
    { code: `0xef0100${bank.slice(2)}` },
    { implementationCode: "0x" },
  ]) {
    const { client, operation, state, requests } = walletBoundary()
    Object.assign(state, patch)
    await assert.rejects(client.transact("deposit", "1", () => {}, operation))
    assert.equal(
      requests.some((request) => /send/i.test(request.method)),
      false
    )
  }
})

test("拒签只调用一次钱包，签名前账户变化时零发送", async () => {
  const { client, operation, state, requests } = walletBoundary()
  state.onSend = () => {
    throw Object.assign(new Error("User rejected"), { code: 4001 })
  }
  await assert.rejects(client.transact("deposit", "1", () => {}, operation))
  assert.equal(requests.filter((request) => request.method === "wallet_sendCalls").length, 1)
  requests.length = 0
  await assert.rejects(
    client.transact(
      "deposit",
      "1",
      () => {
        state.selected = bank
      },
      operation
    ),
    /账户已变化/
  )
  assert.equal(
    requests.some((request) => /send/i.test(request.method)),
    false
  )
})

test("终止后仍保存晚返回的批次 ID，恢复只查询原批次而不重发", async () => {
  const { provider, operation, state, requests, saved } = walletBoundary()
  const controller = new AbortController()
  state.onSend = () => controller.abort()
  const client = createBank(provider, 11155111, bank, account, () => true, controller.signal)
  await assert.rejects(
    client.transact("deposit", "1", () => {}, operation),
    { name: "AbortError" }
  )
  assert.deepEqual(saved, ["pending", "batch-1"])
  assert.equal(
    requests.some((request) => request.method === "wallet_getCallsStatus"),
    false
  )
  const restored = createBank(provider, 11155111, bank, account)
  assert.equal(
    await restored.transact("deposit", "1", () => {}, { ...operation, callsId: "batch-1" }),
    transactionHash
  )
  assert.equal(requests.filter((request) => request.method === "wallet_sendCalls").length, 1)
  await assert.rejects(
    restored.transact("deposit", "1", () => {}, { ...operation, batchPending: true }),
    /结果不明/
  )
  assert.equal(requests.filter((request) => request.method === "wallet_sendCalls").length, 1)
})

test("待定、多回执、非原子、错误网络、错误委托及部分失败不能确认为一笔存款", async () => {
  for (const kind of [
    "pending",
    "multiple",
    "non-atomic",
    "chain",
    "delegate",
    "partial",
    "missing",
  ]) {
    const { client, state } = walletBoundary()
    state.code = delegation
    if (kind === "pending") {
      state.status = 100
      state.receipts = []
    }
    if (kind === "multiple") state.receipts.push({ ...state.receipts[0] })
    if (kind === "non-atomic") state.atomic = false
    if (kind === "chain") state.chainId = "0x1"
    if (kind === "delegate") state.code = `0xef0100${bank.slice(2)}`
    if (kind === "partial") state.status = 600
    if (kind === "missing") state.receipts = []
    await assert.rejects(
      client.confirmCalls("batch-1", () => {}, false),
      kind
    )
  }
})

test("恢复编排即使后端报入账也核实批次；拒签可重试，断线结果不明不得重发", async (t) => {
  const boundary = walletBoundary()
  let intent: Intent = {
    operationId,
    account,
    bankAddress: bank,
    chainId: 11155111,
    action: "deposit",
    amount: "1",
    amountRaw: "1000000",
    phase: "prepared",
    depositMode: "eip7702",
  }
  let serverConfirmed = false
  let serverHash = transactionHash
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input)
    const payload = url.endsWith("auth/session")
      ? { address: account, chainId: 11155111 }
      : url.endsWith("/transactions")
        ? { recorded: true }
        : {
            ...intent,
            status: serverConfirmed ? "confirmed" : "pending",
            transactionHash: serverConfirmed ? serverHash : null,
          }
    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    })
  })
  const options = {
    provider: boundary.provider,
    signal: new AbortController().signal,
    isCurrent: () => true,
    persist: (saved: Intent) => {
      intent = saved
    },
    progress: () => {},
    send: true,
  }
  boundary.state.onSend = () => {
    throw Object.assign(new Error("User rejected"), { code: 4001 })
  }
  await assert.rejects(executeIntent(intent, options), /取消/)
  assert.equal(intent.batchPending, false)
  boundary.state.onSend = () => {
    throw new Error("Connection lost")
  }
  await assert.rejects(executeIntent(intent, options))
  assert.equal(intent.batchPending, true)
  const sends = boundary.requests.filter((request) => request.method === "wallet_sendCalls").length
  await assert.rejects(executeIntent(intent, options), /结果不明/)
  assert.equal(
    boundary.requests.filter((request) => request.method === "wallet_sendCalls").length,
    sends
  )

  intent = { ...intent, callsId: "batch-1" }
  serverConfirmed = true
  boundary.state.code = delegation
  boundary.state.atomic = false
  await assert.rejects(executeIntent(intent, { ...options, send: false }), /单笔交易凭证/)
  assert.equal(intent.phase, "unknown")
  boundary.state.atomic = true
  assert.equal((await executeIntent(intent, { ...options, send: false })).phase, "confirmed")
  assert.equal(intent.businessHash, transactionHash)
  serverHash = zeroHash
  await assert.rejects(executeIntent(intent, { ...options, send: false }), /批次|核实/)
  assert.equal(intent.phase, "unknown", "其他交易的银行事件不能完成当前批次验收")
  assert.equal(
    boundary.requests.filter((request) => request.method === "wallet_sendCalls").length,
    sends
  )
})

test("批量模式及不透明批次 ID 持久化，损坏记录不得恢复为普通存款", () => {
  let raw = ""
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value
    },
  }
  const intent = {
    operationId,
    account,
    chainId: 11155111,
    bankAddress: bank,
    action: "deposit" as const,
    amount: "1.000001",
    amountRaw: "1000001",
    phase: "unknown" as const,
    depositMode: "eip7702" as const,
    callsId: "batch-1",
    batchPending: true,
  }
  saveIntent(storage, intent)
  assert.deepEqual(restoreIntent(storage, account, 11155111, bank), intent)
  for (const patch of [
    { callsId: 123 },
    { callsId: "" },
    { depositMode: "other" },
    { depositMode: undefined },
    { batchPending: "yes" },
    { action: "withdraw" },
    { authorization: "permit" },
    { authorization: "permit2" },
  ]) {
    raw = JSON.stringify({ ...intent, ...patch })
    assert.throws(() => restoreIntent(storage, account, 11155111, bank), /本地操作记录无效/)
  }
})

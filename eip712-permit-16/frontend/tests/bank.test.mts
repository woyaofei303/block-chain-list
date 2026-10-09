import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import { BaseError, UserRejectedRequestError } from "viem"
import { parseAmount } from "../domains/bank/client.ts"
import { loadTransfers } from "../domains/transfers/client.ts"
import { errorMessage } from "../shared/web3.ts"

// 构造钱包拒绝错误，检查页面提示没有把连接失败说成代币授权失败。
test("连接或切换网络被拒绝时，不误报为 Token 授权", () => {
  const rejected = new BaseError("Switch failed", {
    cause: new UserRejectedRequestError(new Error("User rejected")),
  })
  assert.equal(errorMessage(rejected), "已取消钱包请求，请在钱包中确认后重试。")
  assert.equal(errorMessage(new BaseError("RPC unavailable")), "RPC unavailable")
})

// 以最小单位断言换算结果；超出精度直接拒绝，不能先舍入再转账。
test("金额保留最小单位精度，拒绝零、负数、超精度和超额输入", () => {
  assert.equal(parseAmount("1.000001", 6, 2_000_000n), 1_000_001n)
  assert.equal(parseAmount("0.000000000000000001", 18, 1n), 1n)
  assert.equal(parseAmount("9007199254740993", 0, 9007199254740993n), 9007199254740993n)
  for (const value of ["", "0", "-1", "1e3", "NaN", "0.0000001", "2.000001"]) {
    assert.throws(() => parseAmount(value, 6, 2_000_000n))
  }
})

// 用假 HTTP 响应检查金额与分页，并故意换链或代币，确保错误数据不会显示。
test("转账 API 保留精确金额及分页，拒绝混用网络或 Token", async (t) => {
  const token = `0x${"a".repeat(40)}` as const
  const account = `0x${"b".repeat(40)}` as const
  const row = {
    transactionHash: `0x${"1".repeat(64)}`,
    logIndex: 0,
    blockNumber: "120",
    fromAddress: token,
    toAddress: account,
    valueRaw: "9007199254740993123456789",
  }
  const payload = {
    chainId: 11155111,
    tokenAddress: token,
    address: account,
    decimals: 18,
    indexedThrough: "123",
    transfers: [row],
  }
  let responseBody: unknown = payload
  let statusCode = 200
  let query = new URLSearchParams()
  const server = createServer((request, response) => {
    query = new URL(request.url || "/", "http://localhost").searchParams
    response.writeHead(statusCode, { "content-type": "application/json" })
    response.end(JSON.stringify(responseBody))
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const endpoint = `http://127.0.0.1:${address.port}/transfers`
  const expected = { chainId: 11155111, token, account, decimals: 18 }
  const page = await loadTransfers(endpoint, expected, 10)
  assert.equal(page.transfers[0].valueRaw, row.valueRaw)
  assert.equal(query.get("address"), account)
  assert.equal(query.get("offset"), "10")
  assert.equal(query.get("limit"), "10")
  responseBody = { ...payload, indexedThrough: null, transfers: [] }
  assert.deepEqual(await loadTransfers(endpoint, expected), {
    indexedThrough: null,
    transfers: [],
  })
  for (const mismatch of [
    { chainId: 8453 },
    { tokenAddress: account },
    { address: token },
    { decimals: 6 },
  ]) {
    responseBody = { ...payload, ...mismatch }
    await assert.rejects(loadTransfers(endpoint, expected), /不匹配/)
  }
  responseBody = { ...payload, transfers: [{ ...row, valueRaw: "1.5" }] }
  await assert.rejects(loadTransfers(endpoint, expected), /无效数据/)
  responseBody = { ...payload, indexedThrough: 123 }
  await assert.rejects(loadTransfers(endpoint, expected), /无效数据/)
  for (const invalid of [null, { ...payload, transfers: [null] }]) {
    responseBody = invalid
    await assert.rejects(loadTransfers(endpoint, expected), /无效数据/)
  }
  statusCode = 503
  await assert.rejects(loadTransfers(endpoint, expected), /503/)
})

// 修改本地恢复记录，检查旧编号能继续使用，而账户变化或损坏记录不能变成一笔新交易。
test("刷新恢复保留操作编号与交易阶段，账户和网络隔离，损坏记录不能静默生成新操作", async () => {
  const { newOperationId, saveIntent, restoreIntent } = await import(
    "../domains/operations/client.ts"
  )
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  const account = `0x${"a".repeat(40)}` as const
  const bank = `0x${"b".repeat(40)}` as const
  const intent = {
    operationId: newOperationId(),
    account,
    bankAddress: bank,
    chainId: 31337,
    action: "deposit" as const,
    amount: "1",
    amountRaw: "1000000000000000000",
    phase: "approval" as const,
    approvalHash: newOperationId(),
  }
  saveIntent(storage, intent)
  assert.deepEqual(restoreIntent(storage, account, 31337, bank), intent)
  assert.equal(restoreIntent(storage, account, 1, bank), undefined)
  assert.equal(restoreIntent(storage, bank, 31337, bank), undefined)
  for (const key of values.keys()) values.set(key, "{bad")
  assert.throws(() => restoreIntent(storage, account, 31337, bank))
})

// 只有本次已确认的意图能被清除，另一个标签页写入的新意图必须保留。
test("成功后释放当前操作的恢复记录，未确认或其他操作的记录不能清除", async () => {
  const { clearConfirmedIntent, newOperationId, saveIntent, restoreIntent } = await import(
    "../domains/operations/client.ts"
  )
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
  const intent = {
    operationId: newOperationId(),
    account: `0x${"a".repeat(40)}` as const,
    bankAddress: `0x${"b".repeat(40)}` as const,
    chainId: 31337,
    action: "deposit" as const,
    amount: "20",
    amountRaw: "20000000000000000000",
    phase: "unknown" as const,
  }
  /** 始终按同一账户、网络和银行恢复，下面修改存储来检查隔离与损坏输入。 */
  const restore = () => restoreIntent(storage, intent.account, intent.chainId, intent.bankAddress)
  saveIntent(storage, intent)
  assert.throws(() => clearConfirmedIntent(storage, intent), /尚未确认/)
  assert.deepEqual(restore(), intent)

  const confirmed = { ...intent, phase: "confirmed" as const, businessHash: newOperationId() }
  saveIntent(storage, confirmed)
  clearConfirmedIntent(storage, confirmed)
  assert.equal(restore(), undefined)

  const next = { ...intent, operationId: newOperationId() }
  saveIntent(storage, next)
  assert.throws(() => clearConfirmedIntent(storage, confirmed), /已变化/)
  assert.deepEqual(restore(), next)
})

// 覆盖旧记录和新增签名授权方式，恢复后不能偷偷切回另一种存款流程。
test("Permit / Permit2 恢复沿用原编号和授权方式，旧记录兼容，损坏授权方式被拒绝", async () => {
  const { restoreIntent, saveIntent, newOperationId } = await import(
    "../domains/operations/client.ts"
  )
  let raw = ""
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value
    },
  }
  const intent = {
    operationId: newOperationId(),
    account: `0x${"a".repeat(40)}` as const,
    bankAddress: `0x${"b".repeat(40)}` as const,
    chainId: 31337,
    action: "deposit" as const,
    authorization: "permit" as const,
    amount: "1",
    amountRaw: "1000000000000000000",
    phase: "prepared" as const,
  }
  saveIntent(storage, intent)
  assert.deepEqual(restoreIntent(storage, intent.account, 31337, intent.bankAddress), intent)
  const permit2 = { ...intent, authorization: "permit2" as const }
  saveIntent(storage, permit2)
  assert.deepEqual(restoreIntent(storage, intent.account, 31337, intent.bankAddress), permit2)
  for (const invalid of [
    { authorization: "invalid" },
    { action: "withdraw" },
    { action: "withdraw", authorization: "permit2" },
  ]) {
    raw = JSON.stringify({ ...intent, ...invalid })
    assert.throws(() => restoreIntent(storage, intent.account, 31337, intent.bankAddress), /无效/)
  }
})

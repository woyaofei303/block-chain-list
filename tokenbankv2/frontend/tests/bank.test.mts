import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import { BaseError, UserRejectedRequestError } from "viem"
import { errorMessage, loadTransfers, parseAmount } from "../lib/bank.ts"

test("连接或切换网络被拒绝时，不误报为 Token 授权", () => {
  const rejected = new BaseError("Switch failed", {
    cause: new UserRejectedRequestError(new Error("User rejected")),
  })
  assert.equal(errorMessage(rejected), "已取消钱包请求，请在钱包中确认后重试。")
  assert.equal(
    errorMessage(new BaseError("RPC unavailable")),
    "RPC unavailable"
  )
})

test("金额保留最小单位精度，拒绝零、负数、超精度和超额输入", () => {
  assert.equal(parseAmount("1.000001", 6, 2_000_000n), 1_000_001n)
  assert.equal(parseAmount("0.000000000000000001", 18, 1n), 1n)
  assert.equal(
    parseAmount("9007199254740993", 0, 9007199254740993n),
    9007199254740993n
  )
  for (const value of ["", "0", "-1", "1e3", "NaN", "0.0000001", "2.000001"]) {
    assert.throws(() => parseAmount(value, 6, 2_000_000n))
  }
})

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

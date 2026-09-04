import assert from "node:assert/strict"
import test from "node:test"
import { createNode } from "../src/node.mjs"

async function request(url, options) {
  const response = await fetch(url, options)
  const body = await response.json()
  return { status: response.status, body }
}

test("HTTP API 提交交易并挖矿", async (context) => {
  const node = createNode({ name: "http-test", port: 0, difficulty: 1, logger: null })
  await node.start()
  context.after(() => node.stop())

  const invalid = await request(`${node.httpUrl}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "alice", to: "bob", amount: 0 }),
  })
  assert.equal(invalid.status, 400)

  const accepted = await request(`${node.httpUrl}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "alice", to: "bob", amount: 10 }),
  })
  assert.equal(accepted.status, 201)
  assert.equal(accepted.body.transaction.from, "alice")

  const mined = await request(`${node.httpUrl}/mine`, { method: "POST" })
  assert.equal(mined.status, 201)
  assert.match(mined.body.block.hash, /^0/)
  assert.equal(mined.body.block.transactions.length, 1)
  assert.ok(mined.body.miningMs >= 0)

  const chain = await request(`${node.httpUrl}/chain`)
  const status = await request(`${node.httpUrl}/status`)
  assert.equal(chain.body.chain.length, 2)
  assert.equal(status.body.height, 1)
  assert.equal(status.body.pendingTransactions, 0)
})

test("HTTP API 拒绝错误 JSON 和未知路由", async (context) => {
  const node = createNode({ port: 0, difficulty: 1, logger: null })
  await node.start()
  context.after(() => node.stop())

  const badJson = await request(`${node.httpUrl}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  })
  assert.equal(badJson.status, 400)

  const missing = await request(`${node.httpUrl}/missing`)
  assert.equal(missing.status, 404)
})

test("HTTP 节点可重复启停且停止后不保留地址", async () => {
  const node = createNode({ port: 0, difficulty: 1, logger: null })
  await node.start()
  const url = node.httpUrl
  try {
    for (let index = 0; index < 11; index += 1) await node.start()
    assert.equal(node.httpUrl, url)
  } finally {
    await node.stop()
  }
  assert.equal(node.httpUrl, undefined)
  for (let index = 0; index < 11; index += 1) await node.stop()
})

test("logger 抛错不影响节点启动或 500 响应", async (context) => {
  const node = createNode({
    port: 0,
    difficulty: 1,
    logger: {
      info() {
        throw new Error("日志启动失败")
      },
      error() {
        throw new Error("日志错误失败")
      },
    },
  })
  await node.start()
  context.after(() => node.stop())
  assert.equal((await request(`${node.httpUrl}/status`)).status, 200)

  node.state.minePendingTransactions = () => {
    throw new Error("挖矿异常")
  }
  const response = await request(`${node.httpUrl}/mine`, {
    method: "POST",
    signal: AbortSignal.timeout(1_000),
  })
  assert.equal(response.status, 500)
  assert.equal(response.body.error, "服务器内部错误")
})

test("async logger 拒绝不影响节点启动或 500 响应", async (context) => {
  const rejections = []
  const onUnhandledRejection = (error) => rejections.push(error)
  process.on("unhandledRejection", onUnhandledRejection)
  context.after(() => process.off("unhandledRejection", onUnhandledRejection))

  const node = createNode({
    port: 0,
    difficulty: 1,
    logger: {
      async info() {
        throw new Error("异步日志启动失败")
      },
      async error() {
        throw new Error("异步日志错误失败")
      },
    },
  })
  await node.start()
  context.after(() => node.stop())
  assert.equal((await request(`${node.httpUrl}/status`)).status, 200)

  node.state.minePendingTransactions = () => {
    throw new Error("挖矿异常")
  }
  assert.equal((await request(`${node.httpUrl}/mine`, { method: "POST" })).status, 500)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(rejections, [])
})

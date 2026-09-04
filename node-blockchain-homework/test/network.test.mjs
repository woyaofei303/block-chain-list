import assert from "node:assert/strict"
import test from "node:test"
import WebSocket from "ws"
import { createNode } from "../src/node.mjs"

async function waitFor(predicate, message, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return response.json()
}

test("落后节点同步链并接收实时交易和区块", async (context) => {
  const nodeA = createNode({ name: "node-a", port: 0, difficulty: 1, logger: null })
  const nodeB = createNode({ name: "node-b", port: 0, difficulty: 1, logger: null })
  await nodeA.start()
  await post(`${nodeA.httpUrl}/transactions`, { from: "alice", to: "bob", amount: 10 })
  await post(`${nodeA.httpUrl}/mine`)
  await nodeB.start()
  context.after(async () => Promise.all([nodeA.stop(), nodeB.stop()]))

  nodeB.connect(nodeA.p2pUrl)
  await waitFor(
    () => nodeB.state.chain.at(-1).hash === nodeA.state.chain.at(-1).hash,
    "node-b 没有同步 node-a 的已有区块"
  )

  const second = await post(`${nodeA.httpUrl}/transactions`, {
    from: "carol",
    to: "dave",
    amount: 5,
  })
  await waitFor(
    () => nodeB.state.mempool.some((item) => item.id === second.transaction.id),
    "node-b 没有收到交易广播"
  )

  await post(`${nodeA.httpUrl}/mine`)
  await waitFor(
    () => nodeB.state.chain.at(-1).hash === nodeA.state.chain.at(-1).hash,
    "node-b 没有收到新区块广播"
  )
  assert.equal(nodeB.state.mempool.length, 0)
})

test("P2P 拒绝无效链", async (context) => {
  const node = createNode({ name: "victim", port: 0, difficulty: 1, logger: null })
  await node.start()
  context.after(() => node.stop())
  const originalTip = node.state.chain.at(-1).hash

  const socket = new WebSocket(node.p2pUrl)
  context.after(() => socket.close())
  await new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
  socket.send(JSON.stringify({
    type: "CHAIN",
    data: { chain: [{ index: 0, hash: "fake" }] },
  }))
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.equal(node.state.chain.at(-1).hash, originalTip)
})

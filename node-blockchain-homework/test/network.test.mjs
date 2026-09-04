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

async function get(url) {
  return (await fetch(url)).json()
}

async function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const timeout = setTimeout(() => reject(new Error("WebSocket 未能连接")), 1_000)
    socket.once("open", () => {
      clearTimeout(timeout)
      resolve(socket)
    })
    socket.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
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

test("中继节点同步后通知下游节点拉取链", async (context) => {
  const nodeA = createNode({ name: "node-a", port: 0, difficulty: 1, logger: null })
  const nodeB = createNode({ name: "node-b", port: 0, difficulty: 1, logger: null })
  const nodeC = createNode({ name: "node-c", port: 0, difficulty: 1, logger: null })
  await nodeA.start()
  await post(`${nodeA.httpUrl}/transactions`, { from: "alice", to: "bob", amount: 10 })
  await post(`${nodeA.httpUrl}/mine`)
  await Promise.all([nodeB.start(), nodeC.start()])
  context.after(() => Promise.all([nodeA.stop(), nodeB.stop(), nodeC.stop()]))

  nodeC.connect(nodeB.p2pUrl)
  await waitFor(() => get(`${nodeB.httpUrl}/status`).then((status) => status.peers === 1), "node-b 未连接 node-c")
  nodeB.connect(nodeA.p2pUrl)

  await waitFor(
    () => nodeC.state.chain.at(-1).hash === nodeA.state.chain.at(-1).hash,
    "node-c 没有收到 node-b 的同步通知"
  )
})

test("无效区块不阻止同 hash 的有效区块", async (context) => {
  const miner = createNode({ name: "miner", port: 0, difficulty: 1, logger: null })
  const victim = createNode({ name: "victim", port: 0, difficulty: 1, logger: null })
  await Promise.all([miner.start(), victim.start()])
  context.after(() => Promise.all([miner.stop(), victim.stop()]))
  await post(`${miner.httpUrl}/transactions`, { from: "alice", to: "bob", amount: 10 })
  const { block } = await post(`${miner.httpUrl}/mine`)
  const socket = await openSocket(victim.p2pUrl)
  context.after(() => socket.close())

  socket.send(JSON.stringify({
    type: "BLOCK",
    data: { block: { ...block, previousHash: "f".repeat(64) } },
  }))
  await new Promise((resolve) => setTimeout(resolve, 30))
  socket.send(JSON.stringify({ type: "BLOCK", data: { block } }))

  await waitFor(
    () => victim.state.chain.at(-1).hash === block.hash,
    "有效区块被先前无效消息永久抑制"
  )
})

test("未启动节点 stop 会关闭其已建立的 outbound socket", async (context) => {
  const remote = createNode({ name: "remote", port: 0, difficulty: 1, logger: null })
  const local = createNode({ name: "local", port: 0, difficulty: 1, logger: null })
  await remote.start()
  context.after(() => Promise.all([remote.stop(), local.stop()]))

  local.connect(remote.p2pUrl)
  await waitFor(() => get(`${remote.httpUrl}/status`).then((status) => status.peers === 1), "outbound socket 未建立")
  await local.stop()
  await waitFor(() => get(`${remote.httpUrl}/status`).then((status) => status.peers === 0), "stop 留下 outbound socket")
})

test("节点重启后仍接受 P2P 连接", async (context) => {
  const node = createNode({ name: "restart", port: 0, difficulty: 1, logger: null })
  await node.start()
  await node.stop()
  await node.start()
  context.after(() => node.stop())

  const socket = await openSocket(node.p2pUrl)
  context.after(() => socket.close())
  assert.equal((await get(`${node.httpUrl}/status`)).peers, 1)
})

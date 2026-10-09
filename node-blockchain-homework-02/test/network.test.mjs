import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import test from "node:test"
import WebSocket from "ws"
import { poll, requestJson } from "../demo.mjs"
import { createTransaction } from "../src/blockchain.mjs"
import { createNode } from "../src/node.mjs"

/** 给异步节点传播留出有限时间，轮询达到条件就结束，超时输出当前测试的具体原因。 */
async function waitFor(predicate, message, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(message)
}

/** 向本地测试节点提交 JSON，省去每个场景重复组装请求头。 */
async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return response.json()
}

/** 读取本地节点当前链或内存池，断言观察到的状态而不只看广播是否调用。 */
async function get(url) {
  return (await fetch(url)).json()
}

/** 最多等待一秒建立测试连接，成功与失败都清掉超时计时器。 */
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

// 先让一个节点落后，再连接同步并发送新交易，观察双方最终链与内存池。
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

// 通过 WebSocket 发送坏链，检查本地有效链不被覆盖。
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

// 同一连接先发坏消息再发合法交易，验证异常隔离只丢弃当前消息。
test("P2P 记录坏消息并在同一连接继续接收有效交易", async (context) => {
  const errors = []
  const node = createNode({
    name: "message-test",
    port: 0,
    difficulty: 1,
    logger: { error: (value) => errors.push(String(value)) },
  })
  await node.start()
  context.after(() => node.stop())
  const socket = await openSocket(node.p2pUrl)
  context.after(() => socket.close())

  socket.send("{")
  socket.send(JSON.stringify(null))
  socket.send(JSON.stringify({ type: "UNKNOWN", data: {} }))
  socket.send(JSON.stringify({ type: "GET_CHAIN", data: null }))
  socket.send(JSON.stringify({ type: "TRANSACTION", data: { transaction: null } }))
  const transaction = createTransaction({ from: "alice", to: "bob", amount: 1 }, 1)
  socket.send(JSON.stringify({ type: "TRANSACTION", data: { transaction } }))

  await waitFor(
    () => node.state.mempool.some((item) => item.id === transaction.id),
    "坏消息后未接收有效交易"
  )
  assert.deepEqual(errors, [
    "拒绝 P2P 消息：JSON 无效",
    "拒绝 P2P 消息：消息必须是对象",
    "拒绝 P2P 消息：未知 type",
    "拒绝 P2P 消息：data 必须是对象",
    "拒绝 P2P 消息：TRANSACTION data.transaction 无效",
  ])
  assert.deepEqual(node.state.mempool, [transaction])
})

// 用三节点连接检查中继更新后会通知下游，避免链只同步到一半。
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

// 先发伪造内容再发相同哈希的合法区块，检查坏数据没有提前占用去重标记。
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

// 尚未启动监听的节点也可能主动连出，stop 必须清掉这种连接。
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

// 重启实例后重新连接 P2P，检查监听器没有沿用已关闭的服务。
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

// 通过子进程观察 READY 输出，让演示脚本能等服务真正就绪再调用。
test("节点 CLI 启动后打印 READY", async () => {
  const child = spawn(process.execPath, [
    "src/node.mjs",
    "--name", "cli-test",
    "--port", "0",
    "--difficulty", "1",
  ], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] })

  try {
    const output = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CLI 启动超时")), 3000)
      child.stdout.once("data", (chunk) => {
        clearTimeout(timer)
        resolve(chunk.toString())
      })
      child.once("error", reject)
      child.once("exit", (code, signal) => {
        clearTimeout(timer)
        reject(new Error(`CLI 未打印 READY 就退出: code=${code}, signal=${signal}`))
      })
    })
    assert.match(output, /\[cli-test\] READY http:\/\/127\.0\.0\.1:\d+/)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM")
      await new Promise((resolve) => child.once("exit", resolve))
    }
  }
})

// 给 CLI 非法 peer 地址，检查启动前即拒绝，而不是运行后反复连接失败。
test("节点 CLI 拒绝非法 peer", async (context) => {
  for (const peer of ["http://127.0.0.1:3001/p2p", "not a URL"]) {
    await context.test(peer, async () => {
      const child = spawn(process.execPath, [
        "src/node.mjs",
        "--port", "0",
        "--peer", peer,
      ], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk) => { stdout += chunk })
      child.stderr.on("data", (chunk) => { stderr += chunk })

      try {
        const { code } = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("非法 peer 未在 3 秒内退出")), 3000)
          child.once("exit", (exitCode) => {
            clearTimeout(timer)
            resolve({ code: exitCode })
          })
          child.once("error", reject)
        })
        assert.notEqual(code, 0)
        assert.doesNotMatch(stdout, / READY /)
        assert.match(stderr, /启动失败/)
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGTERM")
          await once(child, "exit")
        }
      }
    })
  }
})

// 制造单次请求过慢，检查演示轮询受总截止时间约束。
test("demo 轮询不会让慢请求突破总超时", async (context) => {
  const server = createServer((_, response) => {
    setTimeout(() => response.end("{}"), 250)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  context.after(() => new Promise((resolve) => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}`
  const startedAt = performance.now()

  await assert.rejects(
    poll((timeoutMs) => requestJson(url, { timeoutMs }), "慢请求", 50),
    /慢请求 超时/
  )
  assert.ok(performance.now() - startedAt < 200, "轮询超出 50 ms 预算过多")
})

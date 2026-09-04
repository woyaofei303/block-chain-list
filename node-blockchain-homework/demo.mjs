import { once } from "node:events"
import { createServer } from "node:net"
import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

const TIMEOUT_MS = 3_000

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function withTimeout(promise, description) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${description} 超时（${TIMEOUT_MS} ms）`)), TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function unusedPort() {
  const server = createServer()
  await withTimeout(once(server.listen(0, "127.0.0.1"), "listening"), "分配临时端口")
  const { port } = server.address()
  await withTimeout(once(server.close(), "close"), "释放临时端口")
  return port
}

export async function requestJson(url, { timeoutMs = TIMEOUT_MS, ...options } = {}) {
  let response
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))) })
  } catch (error) {
    throw new Error(`请求 ${url} 失败或超时: ${error.message}`)
  }
  if (!response.ok) throw new Error(`请求 ${url} 返回 HTTP ${response.status}`)
  return response.json()
}

export async function poll(predicate, description, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await predicate(Math.max(1, deadline - Date.now()))) return
    } catch (error) {
      lastError = error
    }
    await delay(Math.min(30, Math.max(0, deadline - Date.now())))
  }
  throw new Error(`${description} 超时（${timeoutMs} ms）${lastError ? `: ${lastError.message}` : ""}`)
}

function forwardLines(stream, name, onLine) {
  let buffered = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    buffered += chunk
    const lines = buffered.split("\n")
    buffered = lines.pop()
    for (const line of lines) {
      if (!line) continue
      process.stderr.write(`[${name}] ${line}\n`)
      onLine?.(line)
    }
  })
}

function startNode({ name, port, peer }) {
  const args = ["src/node.mjs", "--name", name, "--port", String(port), "--difficulty", "2"]
  if (peer) args.push("--peer", peer)
  const child = spawn(process.execPath, args, {
    cwd: new URL(".", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
  })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} READY 超时（${TIMEOUT_MS} ms）`)), TIMEOUT_MS)
    const settle = (callback, value) => {
      clearTimeout(timer)
      callback(value)
    }
    forwardLines(child.stdout, name, (line) => {
      if (line.includes(" READY ")) settle(resolve)
    })
    forwardLines(child.stderr, name)
    child.once("error", (error) => settle(reject, new Error(`${name} 启动失败: ${error.message}`)))
    child.once("exit", (code, signal) => {
      settle(reject, new Error(`${name} 未 READY 就退出: code=${code}, signal=${signal}`))
    })
  })
  return { child, ready }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  try {
    await withTimeout(once(child, "exit"), "等待子进程退出")
  } catch (error) {
    child.kill("SIGKILL")
    await withTimeout(once(child, "exit"), "强制终止子进程")
    throw error
  }
}

async function runDemo() {
  let nodeA
  let nodeB
  try {
    const [portA, portB] = await Promise.all([unusedPort(), unusedPort()])
    nodeA = startNode({ name: "node-a", port: portA })
    await nodeA.ready
    const httpA = `http://127.0.0.1:${portA}`

    await requestJson(`${httpA}/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "alice", to: "bob", amount: 10 }),
    })
    const firstMine = await requestJson(`${httpA}/mine`, { method: "POST" })
    console.log(`交易1已打包: block=${firstMine.block.index}, tx=${firstMine.block.transactions.length}`)
    console.log(`挖矿耗时: block=1, ${firstMine.miningMs.toFixed(3)} ms`)

    nodeB = startNode({ name: "node-b", port: portB, peer: `ws://127.0.0.1:${portA}/p2p` })
    await nodeB.ready
    const httpB = `http://127.0.0.1:${portB}`
    await poll(async (timeoutMs) => {
      const [statusA, statusB] = await Promise.all([
        requestJson(`${httpA}/status`, { timeoutMs }),
        requestJson(`${httpB}/status`, { timeoutMs }),
      ])
      return statusA.tipHash === statusB.tipHash
    }, "落后节点同步")
    const synced = await Promise.all([requestJson(`${httpA}/status`), requestJson(`${httpB}/status`)])
    console.log(`落后节点同步成功: node-a高度=${synced[0].height}, node-b高度=${synced[1].height}`)

    const second = await requestJson(`${httpA}/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "carol", to: "dave", amount: 5 }),
    })
    await poll(
      async (timeoutMs) => (await requestJson(`${httpB}/mempool`, { timeoutMs })).transactions.some((transaction) => transaction.id === second.transaction.id),
      "交易广播"
    )
    console.log(`交易广播成功: node-b待处理交易=${(await requestJson(`${httpB}/mempool`)).transactions.length}`)

    const secondMine = await requestJson(`${httpA}/mine`, { method: "POST" })
    console.log(`挖矿耗时: block=2, ${secondMine.miningMs.toFixed(3)} ms`)
    await poll(async (timeoutMs) => {
      const [statusA, statusB] = await Promise.all([
        requestJson(`${httpA}/status`, { timeoutMs }),
        requestJson(`${httpB}/status`, { timeoutMs }),
      ])
      return statusA.tipHash === statusB.tipHash
    }, "新区块广播")
    const [statusA, statusB] = await Promise.all([requestJson(`${httpA}/status`), requestJson(`${httpB}/status`)])
    console.log(`新区块广播成功: node-a高度=${statusA.height}, node-b高度=${statusB.height}`)
    console.log(`两个节点链头一致: ${statusA.tipHash === statusB.tipHash}`)
  } finally {
    await Promise.all([nodeA && stopChild(nodeA.child), nodeB && stopChild(nodeB.child)])
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDemo()
}

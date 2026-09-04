import { createServer } from "node:http"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import WebSocket, { WebSocketServer } from "ws"
import { Blockchain } from "./blockchain.mjs"

const MAX_BODY_BYTES = 64 * 1024
const MESSAGE_TYPES = new Set(["HELLO", "TRANSACTION", "BLOCK", "GET_CHAIN", "CHAIN"])

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validatePeerUrls(peers) {
  for (const peer of peers) {
    const url = new URL(peer)
    if (!url.hostname || (url.protocol !== "ws:" && url.protocol !== "wss:")) {
      throw new TypeError(`peer 必须是 ws:// 或 wss:// URL: ${peer}`)
    }
  }
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value)
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new RangeError("请求体不能超过 64 KiB")
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new SyntaxError("请求体必须是合法 JSON")
  }
}

export function createNode({ name = "node", port = 0, difficulty, logger, peers = [] } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("端口必须是 0 到 65535 的整数")
  }
  const state = new Blockchain({ difficulty })
  let httpUrl
  let p2pUrl
  let startPromise
  const log = (method, value) => {
    try {
      void Promise.resolve(logger?.[method]?.(value)).catch(() => {})
    } catch {}
  }
  const sockets = new Set()
  const pendingSockets = new Set()
  const seenBlocks = new Set(state.chain.map((block) => block.hash))
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1")
      if (request.method === "GET" && url.pathname === "/status") {
        return sendJson(response, 200, {
          name,
          height: state.chain.length - 1,
          tipHash: state.tip.hash,
          pendingTransactions: state.mempool.length,
          peers: sockets.size,
        })
      }
      if (request.method === "GET" && url.pathname === "/chain") {
        return sendJson(response, 200, { chain: state.chain })
      }
      if (request.method === "GET" && url.pathname === "/mempool") {
        return sendJson(response, 200, { transactions: state.mempool })
      }
      if (request.method === "POST" && url.pathname === "/transactions") {
        const transaction = state.createAndAddTransaction(await readJson(request))
        broadcast("TRANSACTION", { transaction })
        return sendJson(response, 201, { transaction })
      }
      if (request.method === "POST" && url.pathname === "/mine") {
        const { block, elapsedMs } = state.minePendingTransactions()
        seenBlocks.add(block.hash)
        broadcast("BLOCK", { block })
        log("info", `挖矿耗时=${elapsedMs.toFixed(3)} ms`)
        return sendJson(response, 201, { block, miningMs: elapsedMs })
      }
      return sendJson(response, 404, { error: "接口不存在" })
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) {
        return sendJson(response, 400, { error: error.message })
      }
      log("error", error)
      return sendJson(response, 500, { error: "服务器内部错误" })
    }
  })
  let webSocketServer

  function send(socket, type, data = {}) {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, data }))
      }
    } catch (error) {
      log("error", error)
    }
  }

  function broadcast(type, data, excludedSocket) {
    for (const socket of sockets) {
      if (socket !== excludedSocket) send(socket, type, data)
    }
  }

  function handleMessage(socket, raw) {
    try {
      const message = JSON.parse(raw.toString())
      if (
        !isRecord(message) ||
        typeof message.type !== "string" ||
        !MESSAGE_TYPES.has(message.type) ||
        !isRecord(message.data)
      ) return

      switch (message.type) {
        case "HELLO":
          if (typeof message.data.tipHash !== "string") return
          // 握手只比较链头；不一致时由落后节点主动索取完整链。
          if (message.data.tipHash !== state.tip.hash) send(socket, "GET_CHAIN")
          break
        case "GET_CHAIN":
          send(socket, "CHAIN", { chain: state.chain })
          break
        case "CHAIN": {
          if (!Array.isArray(message.data.chain)) return
          const startedAt = performance.now()
          // 接收方复用共识层校验，只接受累计工作量更大的完整链。
          const replaced = state.replaceChain(message.data.chain)
          if (replaced) {
            for (const block of state.chain) seenBlocks.add(block.hash)
            broadcast("HELLO", {
              name,
              height: state.chain.length - 1,
              tipHash: state.tip.hash,
            }, socket)
          }
          log("info", `链同步=${replaced}, 耗时=${(performance.now() - startedAt).toFixed(3)} ms`)
          break
        }
        case "TRANSACTION":
          if (!isRecord(message.data.transaction)) return
          if (state.addTransaction(message.data.transaction)) {
            broadcast("TRANSACTION", message.data, socket)
          }
          break
        case "BLOCK": {
          const block = message.data.block
          if (!isRecord(block) || typeof block.hash !== "string" || seenBlocks.has(block.hash)) break
          const startedAt = performance.now()
          const accepted = state.appendBlock(block)
          log("info", `验块=${accepted}, 耗时=${(performance.now() - startedAt).toFixed(3)} ms`)
          if (accepted) {
            seenBlocks.add(block.hash)
            broadcast("BLOCK", message.data, socket)
          }
          else send(socket, "GET_CHAIN")
          break
        }
      }
    } catch (error) {
      log("error", error)
    }
  }

  function attachSocket(socket) {
    sockets.add(socket)
    pendingSockets.delete(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.on("error", (error) => log("error", error))
    socket.on("message", (raw) => handleMessage(socket, raw))
    send(socket, "HELLO", {
      name,
      height: state.chain.length - 1,
      tipHash: state.tip.hash,
    })
  }

  function createWebSocketServer() {
    const nextServer = new WebSocketServer({ server, path: "/p2p" })
    nextServer.on("connection", attachSocket)
    nextServer.on("error", (error) => log("error", error))
    return nextServer
  }

  return {
    state,
    get httpUrl() {
      return httpUrl
    },
    get p2pUrl() {
      return p2pUrl
    },
    connect(peerUrl) {
      let socket
      try {
        socket = new WebSocket(peerUrl)
      } catch (error) {
        log("error", error)
        return
      }
      pendingSockets.add(socket)
      const onPendingError = (error) => log("error", error)
      socket.once("open", () => {
        socket.off("error", onPendingError)
        attachSocket(socket)
      })
      socket.once("close", () => pendingSockets.delete(socket))
      socket.once("error", onPendingError)
      return socket
    },
    async start() {
      if (server.listening) return
      if (startPromise) return startPromise
      startPromise = new Promise((resolve, reject) => {
        const cleanup = () => {
          server.off("error", onError)
          server.off("listening", onListening)
        }
        const onError = (error) => {
          cleanup()
          reject(error)
        }
        const onListening = () => {
          cleanup()
          resolve()
        }
        server.once("error", onError)
        server.once("listening", onListening)
        try {
          server.listen(port, "127.0.0.1")
        } catch (error) {
          cleanup()
          reject(error)
        }
      })
      try {
        await startPromise
      } finally {
        startPromise = undefined
      }
      // 端口为 0 时由系统分配，监听后才能读取实际地址。
      webSocketServer = createWebSocketServer()
      httpUrl = `http://127.0.0.1:${server.address().port}`
      p2pUrl = `ws://127.0.0.1:${server.address().port}/p2p`
      log("info", `HTTP 节点 ${name} 已启动：${httpUrl}`)
      for (const peerUrl of peers) this.connect(peerUrl)
    },
    async stop() {
      for (const socket of [...sockets, ...pendingSockets]) socket.terminate()
      const closingWebSocketServer = webSocketServer
      webSocketServer = undefined
      if (closingWebSocketServer) {
        await new Promise((resolve) => closingWebSocketServer.close(() => resolve()))
      }
      if (!server.listening) {
        httpUrl = undefined
        p2pUrl = undefined
        return
      }
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      httpUrl = undefined
      p2pUrl = undefined
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({
      options: {
        name: { type: "string", default: "node" },
        port: { type: "string", default: "3001" },
        difficulty: { type: "string", default: "4" },
        peer: { type: "string", multiple: true, default: [] },
      },
    })
    // 在监听端口前拒绝拼写错误的 peer；不可达的合法地址仍异步重连。
    validatePeerUrls(values.peer)
    const node = createNode({
      name: values.name,
      port: Number(values.port),
      difficulty: Number(values.difficulty),
      peers: values.peer,
      // READY 留在 stdout，方便脚本读取；教学日志走 stderr，不干扰机器解析。
      logger: { info: console.error, error: console.error },
    })
    await node.start()
    console.log(`[${values.name}] READY ${node.httpUrl} p2p=${node.p2pUrl}`)

    const shutdown = async () => {
      try {
        await node.stop()
        process.exit(0)
      } catch (error) {
        console.error(`[${values.name}] 停止失败: ${error.message}`)
        process.exit(1)
      }
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
  } catch (error) {
    console.error(`启动失败: ${error.message}`)
    process.exitCode = 1
  }
}

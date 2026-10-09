import { createServer } from "node:http"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import WebSocket, { WebSocketServer } from "ws"
import { Blockchain } from "./blockchain.mjs"

const MAX_BODY_BYTES = 64 * 1024
const MESSAGE_TYPES = new Set(["HELLO", "TRANSACTION", "BLOCK", "GET_CHAIN", "CHAIN"])

/** 网络消息先确认是对象，再读取 type 和 data，防止无效输入进入状态处理。 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 启动前检查邻居地址使用 WebSocket 协议；地址格式合法仍不保证对端在线。 */
function validatePeerUrls(peers) {
  for (const peer of peers) {
    const url = new URL(peer)
    if (!url.hostname || (url.protocol !== "ws:" && url.protocol !== "wss:")) {
      throw new TypeError(`peer 必须是 ws:// 或 wss:// URL: ${peer}`)
    }
  }
}

/** 把一次 HTTP 结果序列化并结束响应，按 UTF-8 字节数设置长度。 */
function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value)
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  })
  response.end(body)
}

/** 分块读取并限制请求体为 64 KiB，拒绝超长或非法 JSON，尚不处理业务字段。 */
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

/** 组装独立节点；创建后尚未监听端口，调用 start 才能收请求，stop 负责释放连接。 */
export function createNode({ name = "node", port = 0, difficulty, logger, peers = [] } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("端口必须是 0 到 65535 的整数")
  }
  const state = new Blockchain({ difficulty })
  let httpUrl
  let p2pUrl
  let startPromise
  /** 日志失败不能中断验块或关机流程，因此同时隔离同步异常和异步拒绝。 */
  const log = (method, value) => {
    try {
      void Promise.resolve(logger?.[method]?.(value)).catch(() => {})
    } catch {}
  }
  /** 记录拒绝原因供观察；无效邻居消息不会直接终止整个节点。 */
  const rejectP2pMessage = (reason) => log("error", `拒绝 P2P 消息：${reason}`)
  const sockets = new Set()
  const pendingSockets = new Set()
  const seenBlocks = new Set(state.chain.map((block) => block.hash))
  // 节点的 HTTP 总入口：外部操作先在这里转换为 Blockchain 状态变化，再广播给邻居。
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1")
      if (request.method === "GET" && url.pathname === "/status") {
        return sendJson(response, 200, {
          name,
          port: server.address().port,
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
        // 收到交易记录后：校验并创建交易 → 加入 mempool → 广播 TRANSACTION。
        const transaction = state.createAndAddTransaction(await readJson(request))
        broadcast("TRANSACTION", { transaction })
        return sendJson(response, 201, { transaction })
      }
      if (request.method === "POST" && url.pathname === "/mine") {
        // 收到挖矿请求后：打包 mempool 并完成 PoW → 追加本地链 → 广播 BLOCK。
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

  /** 只向已打开的连接发消息；连接中断时记录错误，由后续同步补齐状态。 */
  function send(socket, type, data = {}) {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type, data }))
      }
    } catch (error) {
      log("error", error)
    }
  }

  /** 通知所有已连接邻居，但跳过消息来源，避免立刻原路回传。 */
  function broadcast(type, data, excludedSocket) {
    for (const socket of sockets) {
      if (socket !== excludedSocket) send(socket, type, data)
    }
  }

  /** 先验证消息外形，再按类型交给 Blockchain；网络层不能跳过链的内容校验。 */
  function handleMessage(socket, raw) {
    let message
    try {
      message = JSON.parse(raw.toString())
    } catch {
      rejectP2pMessage("JSON 无效")
      return
    }
    if (!isRecord(message)) {
      rejectP2pMessage("消息必须是对象")
      return
    }
    if (typeof message.type !== "string" || !MESSAGE_TYPES.has(message.type)) {
      rejectP2pMessage("未知 type")
      return
    }
    if (!isRecord(message.data)) {
      rejectP2pMessage("data 必须是对象")
      return
    }

    try {
      switch (message.type) {
        case "HELLO":
          if (typeof message.data.tipHash !== "string") {
            rejectP2pMessage("HELLO data.tipHash 无效")
            return
          }
          // 握手只比较链头；不一致时由落后节点主动索取完整链。
          if (message.data.tipHash !== state.tip.hash) send(socket, "GET_CHAIN")
          break
        case "GET_CHAIN":
          send(socket, "CHAIN", { chain: state.chain })
          break
        case "CHAIN": {
          if (!Array.isArray(message.data.chain)) {
            rejectP2pMessage("CHAIN data.chain 无效")
            return
          }
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
          if (!isRecord(message.data.transaction)) {
            rejectP2pMessage("TRANSACTION data.transaction 无效")
            return
          }
          if (state.addTransaction(message.data.transaction)) {
            broadcast("TRANSACTION", message.data, socket)
          }
          break
        case "BLOCK": {
          const block = message.data.block
          if (!isRecord(block) || typeof block.hash !== "string") {
            rejectP2pMessage("BLOCK data.block 无效")
            break
          }
          if (seenBlocks.has(block.hash)) break
          const startedAt = performance.now()
          const accepted = state.appendBlock(block)
          log("info", `验块=${accepted}, 耗时=${(performance.now() - startedAt).toFixed(3)} ms`)
          if (accepted) {
            seenBlocks.add(block.hash)
            broadcast("BLOCK", message.data, socket)
          }
          else {
            rejectP2pMessage("BLOCK 校验失败")
            send(socket, "GET_CHAIN")
          }
          break
        }
      }
    } catch (error) {
      rejectP2pMessage(error instanceof Error ? error.message : String(error))
    }
  }

  /** 接管已连通的 socket，注册消息和关闭回调，再发送本节点链头进行握手。 */
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

  /** 让同一 HTTP 服务接收 /p2p WebSocket 连接；它与查询接口共用端口。 */
  function createWebSocketServer() {
    const nextServer = new WebSocketServer({ server, path: "/p2p" })
    nextServer.on("connection", attachSocket)
    nextServer.on("error", (error) => log("error", error))
    return nextServer
  }

  return {
    state,
    /** 监听完成后返回实际 HTTP 地址；停止后清空，避免继续使用过期端口。 */
    get httpUrl() {
      return httpUrl
    },
    /** 返回其他节点连接本节点的 /p2p 地址，只有启动完成后才有值。 */
    get p2pUrl() {
      return p2pUrl
    },
    /** 异步拨号邻居；打开前保存在待连接集合，停止节点时这类连接也要关闭。 */
    connect(peerUrl) {
      let socket
      try {
        socket = new WebSocket(peerUrl)
      } catch (error) {
        log("error", error)
        return
      }
      pendingSockets.add(socket)
      /** 拨号尚未成功时也要接住错误，避免无人监听的 error 事件使进程退出。 */
      const onPendingError = (error) => log("error", error)
      socket.once("open", () => {
        socket.off("error", onPendingError)
        attachSocket(socket)
      })
      socket.once("close", () => pendingSockets.delete(socket))
      socket.once("error", onPendingError)
      return socket
    },
    /** 等待监听成功后再建立 P2P 服务；同时调用 start 时复用同一次启动等待。 */
    async start() {
      if (server.listening) return
      if (startPromise) return startPromise
      startPromise = new Promise((resolve, reject) => {
        /** 启动成功或失败都移除临时监听器，避免下次启动继续触发旧回调。 */
        const cleanup = () => {
          server.off("error", onError)
          server.off("listening", onListening)
        }
        /** 把监听失败交回 start 调用者，并移除另一条尚未触发的监听器。 */
        const onError = (error) => {
          cleanup()
          reject(error)
        }
        /** 只有系统确认端口已监听才结束等待，随后才能取得实际分配的端口号。 */
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
    /** 先断开已连接与正在拨号的 socket，再等待服务关闭；只释放本节点创建的资源。 */
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
    // 从命令行直接运行时：解析 CLI → 创建节点 → 启动服务 → 打印 READY → 等待退出信号。
    const { values } = parseArgs({
      options: {
        name: { type: "string", default: "node" },
        port: { type: "string", default: "3001" },
        difficulty: { type: "string", default: "4" },
        peer: { type: "string", multiple: true, default: [] },
      },
    })
    // 在监听端口前拒绝拼写错误的 peer；不可达的合法地址会异步连接并记录错误。
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

    /** 接到退出信号后等待节点释放资源；关闭失败时以非零退出码提示调用方。 */
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

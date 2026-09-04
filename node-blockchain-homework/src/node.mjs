import { createServer } from "node:http"
import { Blockchain } from "./blockchain.mjs"

const MAX_BODY_BYTES = 64 * 1024

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

export function createNode({ name = "node", port = 0, difficulty, logger } = {}) {
  const state = new Blockchain({ difficulty })
  let httpUrl
  let startPromise
  const log = (method, value) => {
    try {
      void Promise.resolve(logger?.[method]?.(value)).catch(() => {})
    } catch {}
  }
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1")
      if (request.method === "GET" && url.pathname === "/status") {
        return sendJson(response, 200, {
          name,
          height: state.chain.length - 1,
          tipHash: state.tip.hash,
          pendingTransactions: state.mempool.length,
          peers: 0,
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
        return sendJson(response, 201, { transaction })
      }
      if (request.method === "POST" && url.pathname === "/mine") {
        const { block, elapsedMs } = state.minePendingTransactions()
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

  return {
    state,
    get httpUrl() {
      return httpUrl
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
      httpUrl = `http://127.0.0.1:${server.address().port}`
      log("info", `HTTP 节点 ${name} 已启动：${httpUrl}`)
    },
    async stop() {
      if (!server.listening) {
        httpUrl = undefined
        return
      }
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
      httpUrl = undefined
    },
  }
}

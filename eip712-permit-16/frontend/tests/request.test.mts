import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { request } from "../shared/request.ts"

test("标签页共享 6 个 HTTP 名额，终止一批不会发送其等待任务或影响其他批次", async (t) => {
  let active = 0
  let peak = 0
  let cancelledStarted = 0
  const server = createServer(async (req, res) => {
    active++
    peak = Math.max(peak, active)
    if (req.url?.startsWith("/cancel")) cancelledStarted++
    await sleep(60)
    active--
    res.end(JSON.stringify({ ok: true }))
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const url = `http://127.0.0.1:${address.port}`
  const parse = (value: unknown) => {
    assert.deepEqual(value, { ok: true })
    return true
  }
  const first = Array.from({ length: 6 }, () => request(`${url}/keep`, { parse }))
  const controller = new AbortController()
  const cancelled = Array.from({ length: 12 }, () =>
    request(`${url}/cancel`, { parse, signal: controller.signal })
  )
  const settled = Promise.allSettled(cancelled)
  controller.abort()
  await Promise.all(first)
  assert.ok((await settled).every((result) => result.status === "rejected"))
  assert.equal(cancelledStarted, 0)
  assert.equal(peak, 6)
  assert.equal(await request(`${url}/keep`, { parse }), true)
})

test("在途取消和超时会中止传输；排队时间不计入超时，取消会停止重试", async (t) => {
  const { createQueryClient } = await import("../shared/query-client.ts")
  const { AppError } = await import("../shared/errors.ts")
  const client = createQueryClient()
  const hits = new Map<string, number>()
  const server = createServer(async (req, res) => {
    const path = req.url ?? "/"
    hits.set(path, (hits.get(path) ?? 0) + 1)
    if (path === "/fail") {
      res.writeHead(503)
      res.end("{}")
      return
    }
    if (path === "/slow") await sleep(100)
    res.end("{}")
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(async () => {
    client.clear()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address === "object")
  const base = `http://127.0.0.1:${address.port}`
  const parse = () => true
  const occupying = Array.from({ length: 6 }, () => request(`${base}/slow`, { parse }))
  assert.equal(await request(`${base}/fast`, { parse, timeoutMs: 20 }), true)
  await Promise.all(occupying)
  await assert.rejects(
    request(`${base}/slow`, { parse, timeoutMs: 10 }),
    (error: unknown) => error instanceof AppError && error.code === "TIMEOUT"
  )
  const abort = new AbortController()
  const running = request(`${base}/slow`, { parse, signal: abort.signal })
  const rejected = assert.rejects(running, { name: "AbortError" })
  await sleep(20)
  abort.abort()
  await rejected
  const options = {
    queryKey: ["same", 1],
    queryFn: ({ signal }: { signal: AbortSignal }) => request(`${base}/slow`, { parse, signal }),
  }
  const before = hits.get("/slow") ?? 0
  await Promise.all([client.fetchQuery(options), client.fetchQuery(options)])
  assert.equal(hits.get("/slow"), before + 1)
  const failure = client.fetchQuery({
    queryKey: ["cancel-retry"],
    queryFn: ({ signal }) => request(`${base}/fail`, { parse, signal }),
  })
  const cancelled = assert.rejects(failure)
  while (!hits.get("/fail")) await sleep(5)
  await client.cancelQueries({ queryKey: ["cancel-retry"] })
  await cancelled
  await sleep(1100)
  assert.equal(hits.get("/fail"), 1)
  await assert.rejects(
    client.fetchQuery({
      queryKey: ["retry-once"],
      queryFn: ({ signal }) => request(`${base}/fail`, { parse, signal }),
    })
  )
  assert.equal(hits.get("/fail"), 3)
})

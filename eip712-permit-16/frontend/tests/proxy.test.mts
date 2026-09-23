import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import { GET } from "../app/api/transfers/route.ts"

test("同源代理保留查询参数及错误状态，拒绝无效服务地址", async (t) => {
  const previous = process.env.INDEXER_URL
  t.after(() => {
    if (previous === undefined) delete process.env.INDEXER_URL
    else process.env.INDEXER_URL = previous
  })
  let received = ""
  let status = 200
  const server = createServer((request, response) => {
    received = request.url ?? ""
    response.writeHead(status, { "content-type": "application/json" })
    response.end(JSON.stringify({ valueRaw: "9007199254740993123456789" }))
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address === "object")
  process.env.INDEXER_URL = `http://127.0.0.1:${address.port}`
  const request = new Request("http://localhost/api/transfers?address=0x123&limit=10&offset=20")
  const result = await GET(request)
  assert.equal(result.status, 200)
  assert.equal(result.headers.get("cache-control"), "no-store")
  assert.equal(received, "/transfers?address=0x123&limit=10&offset=20")
  assert.equal((await result.json()).valueRaw, "9007199254740993123456789")
  status = 400
  assert.equal((await GET(request)).status, 400)
  for (const url of ["broken", "file:///tmp", "ftp://localhost"]) {
    process.env.INDEXER_URL = url
    assert.equal((await GET(request)).status, 500)
  }
  // 端口 0 无服务：连接失败要返回可辨识的 502，不能返回成功空列表。
  process.env.INDEXER_URL = "http://127.0.0.1:0"
  assert.equal((await GET(request)).status, 502)

  delete process.env.INDEXER_URL
  let defaultUpstream = ""
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    defaultUpstream = url.href
    return Response.json({ transfers: [] })
  })
  assert.equal((await GET(request)).status, 200)
  assert.equal(defaultUpstream, "http://127.0.0.1:13016/transfers?address=0x123&limit=10&offset=20")
})

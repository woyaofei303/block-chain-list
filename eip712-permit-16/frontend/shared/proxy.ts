// 只由同源 Route Handler 调用；不得从请求参数选择上游地址。
export async function proxy(request: Request, path: string) {
  const indexer = process.env.INDEXER_URL ?? "http://127.0.0.1:13016"
  if (!URL.canParse(indexer) || !["http:", "https:"].includes(new URL(indexer).protocol))
    return Response.json({ error: "Indexer URL is not configured" }, { status: 500 })
  const upstream = new URL(path, indexer)
  const headers = new Headers()
  // 会话 Cookie、来源校验和幂等键必须一路到达 Express，浏览器只访问本站 /api 路由。
  for (const name of ["content-type", "cookie", "origin", "idempotency-key"]) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  try {
    const result = await fetch(upstream, {
      method: request.method,
      headers,
      cache: "no-store",
      body: request.method === "GET" ? undefined : await request.text(),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    })
    const outgoing = new Headers({
      "cache-control": "no-store",
      "content-type": result.headers.get("content-type") ?? "application/json",
    })
    for (const cookie of result.headers.getSetCookie()) outgoing.append("set-cookie", cookie)
    return new Response(result.body, { status: result.status, headers: outgoing })
  } catch {
    return Response.json(
      { code: "UPSTREAM_UNAVAILABLE", error: "转账服务暂不可用" },
      { status: request.signal.aborted ? 499 : 502 }
    )
  }
}

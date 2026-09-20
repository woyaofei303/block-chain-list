export const dynamic = "force-dynamic"

// 同源入口在开发和生产都可用；查询校验、数据库和索引仍由 Express 负责。
export async function GET(request: Request) {
  const indexerUrl = process.env.INDEXER_URL ?? "http://127.0.0.1:3001"
  if (
    !URL.canParse(indexerUrl) ||
    !["http:", "https:"].includes(new URL(indexerUrl).protocol)
  ) {
    return Response.json(
      { error: "Indexer URL is not configured" },
      { status: 500 }
    )
  }

  const upstreamUrl = new URL("/transfers", indexerUrl)
  upstreamUrl.search = new URL(request.url).search
  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "cache-control": "no-store",
        "content-type":
          upstream.headers.get("content-type") ??
          "application/json; charset=utf-8",
      },
    })
  } catch {
    return Response.json(
      { error: "Transfer indexer is unavailable" },
      { status: 502 }
    )
  }
}

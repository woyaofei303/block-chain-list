import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

const root = fileURLToPath(new URL(".", import.meta.url))
const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
}

export default nextConfig

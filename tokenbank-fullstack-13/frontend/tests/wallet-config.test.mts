import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { test } from "node:test"

test("未配置网络时使用 Foundry，Sepolia 和 Base 必须显式选择", () => {
  const configUrl = new URL("../domains/wallet/config.ts", import.meta.url).href
  const script = `const { targetChain } = await import(${JSON.stringify(configUrl)}); console.log(targetChain.id)`
  for (const [configured, expected] of [
    [undefined, "31337"],
    ["31337", "31337"],
    ["11155111", "11155111"],
    ["8453", "8453"],
  ] as const) {
    const env = { ...process.env }
    if (configured === undefined) delete env.NEXT_PUBLIC_CHAIN_ID
    else env.NEXT_PUBLIC_CHAIN_ID = configured
    const actual = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env,
      encoding: "utf8",
      timeout: 10_000,
    }).trim()
    assert.equal(actual, expected)
  }
})

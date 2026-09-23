import { createConfig, http } from "wagmi"
import { base, foundry, sepolia } from "wagmi/chains"
import { injected } from "wagmi/connectors"

const localRpcUrl = process.env.NEXT_PUBLIC_LOCAL_RPC_URL ?? "http://127.0.0.1:8547"
// 新增钱包网络时也使用同一个 RPC，避免钱包与页面连到不同的本地链。
const localChain = {
  ...foundry,
  rpcUrls: { default: { http: [localRpcUrl] } },
}
export const chains = [sepolia, base, localChain] as const

export const wagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  transports: {
    [sepolia.id]: http(),
    [base.id]: http(),
    [foundry.id]: http(localRpcUrl),
  },
})

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig
  }
}

// 未提供启动配置时默认本地链；公共网络必须通过环境变量明确选择。
const configuredChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? foundry.id)

const configuredChain = chains.find((chain) => chain.id === configuredChainId)
if (!configuredChain) throw new Error("NEXT_PUBLIC_CHAIN_ID 仅支持 11155111、8453、31337")
export const targetChain = configuredChain

export const explorerUrl =
  process.env.NEXT_PUBLIC_EXPLORER_URL ??
  ("blockExplorers" in targetChain ? (targetChain.blockExplorers?.default.url ?? "") : "")

export function explorerLink(kind: "address" | "tx", value: string) {
  return /^https?:\/\//.test(explorerUrl)
    ? `${explorerUrl.replace(/\/$/, "")}/${kind}/${value}`
    : undefined
}

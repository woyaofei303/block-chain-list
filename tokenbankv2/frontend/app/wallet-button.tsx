"use client"

import { useId, useRef, useState } from "react"
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi"
import { errorMessage, shortAddress } from "@/lib/bank"
import { targetChain } from "@/lib/wagmi"

export function WalletButton({
  className = "wallet-button",
}: {
  className?: string
}) {
  const { address, chain, chainId, connector, isConnected } = useConnection()
  const connectors = useConnectors()
  // 有具名钱包时直接使用其 provider，避免默认注入入口连接到另一个扩展。
  const namedConnectors = connectors.filter((item) => item.id !== "injected")
  const walletOptions = namedConnectors.length ? namedConnectors : connectors
  const connect = useConnect()
  const disconnect = useDisconnect()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [error, setError] = useState("")

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setError("")
          dialog.current?.showModal()
        }}
      >
        {isConnected && address ? shortAddress(address) : "连接钱包"}
      </button>
      <dialog ref={dialog} className="modal" aria-labelledby={titleId}>
        <div className="section-heading">
          <h2 id={titleId}>{isConnected ? "我的钱包" : "连接钱包"}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭钱包窗口"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        {isConnected && address ? (
          <>
            <p className="muted">
              {connector?.id === "injected"
                ? "浏览器默认钱包"
                : connector?.name}
              {" · "}
              {chain?.name ?? "未配置的网络"}（{chainId}）
            </p>
            <p className="address-text">{address}</p>
            <p className="small muted">
              目标网络：{targetChain.name}（{targetChain.id}）
              {targetChain.id === 31337 && (
                <>
                  <br />
                  本地 RPC：{targetChain.rpcUrls.default.http[0]}
                </>
              )}
            </p>
            <p className="small muted">
              地址与钱包不一致时，请重新选择钱包，并在钱包的当前网站连接设置中核对账户和网络。
            </p>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                disconnect.mutate()
              }}
            >
              断开并重新选择
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              选择已安装的浏览器钱包，连接到 {targetChain.name}。
            </p>
            <div className="wallet-options">
              {walletOptions.map((connector) => (
                <button
                  key={connector.uid}
                  type="button"
                  disabled={connect.isPending}
                  onClick={async () => {
                    setError("")
                    try {
                      if (!(await connector.getProvider()))
                        throw new Error(
                          "未检测到浏览器钱包。请先安装 MetaMask 等钱包扩展后刷新页面。"
                        )
                      await connect.mutateAsync({
                        connector,
                        chainId: targetChain.id,
                      })
                      dialog.current?.close()
                    } catch (cause) {
                      setError(errorMessage(cause))
                    }
                  }}
                >
                  <span className="wallet-mark" aria-hidden="true">
                    ↗
                  </span>
                  {connector.id === "injected" ? "浏览器钱包" : connector.name}
                  <span className="ml-auto muted">
                    {connect.isPending ? "连接中…" : "→"}
                  </span>
                </button>
              ))}
            </div>
            <p className="small muted">
              连接只读取公开地址。存取款由你在钱包中确认。
            </p>
          </>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </dialog>
    </>
  )
}

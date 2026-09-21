"use client"

import Image from "next/image"
import { useId, useRef, useState } from "react"
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi"
import { targetChain } from "@/domains/wallet/config"
import { errorMessage, shortAddress } from "@/shared/web3"

export function WalletButton({
  className = "rounded-[30px] border border-[#ffe2f6] bg-[#fff0fa] px-[18px] py-2.5 text-[14px] font-semibold whitespace-nowrap text-[#dd08a1] hover:bg-[#ffe2f6] mobile:px-3 mobile:py-[9px] mobile:text-[12px]",
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
        <div className="flex items-center justify-between gap-4 [&_p]:mt-[7px] mobile:[&_h2]:text-[17px]">
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
            <p className="my-3.5 text-[13px] leading-[1.8] text-muted">
              {connector?.id === "injected" ? "浏览器默认钱包" : connector?.name}
              {" · "}
              {chain?.name ?? "未配置的网络"}（{chainId}）
            </p>
            <p className="my-5 text-[13px] wrap-anywhere">{address}</p>
            <p className="mt-2.5 mb-3.5 text-[13px] leading-[1.8] text-muted">
              目标网络：{targetChain.name}（{targetChain.id}）
              {targetChain.id === 31337 && (
                <>
                  <br />
                  本地 RPC：{targetChain.rpcUrls.default.http[0]}
                </>
              )}
            </p>
            <p className="mt-2.5 mb-3.5 text-[13px] leading-[1.8] text-muted">
              地址与钱包不一致时，请重新选择钱包，并在钱包的当前网站连接设置中核对账户和网络。
            </p>
            <button
              type="button"
              className="primary-button mt-4"
              onClick={() => {
                disconnect.mutate()
              }}
            >
              断开并重新选择
            </button>
          </>
        ) : (
          <>
            <p className="my-3.5 text-[13px] leading-[1.8] text-muted">
              选择已安装的浏览器钱包，连接到 {targetChain.name}。
            </p>
            <div className="my-5 grid gap-2">
              {walletOptions.map((connector) => {
                // 列表共用一次连接请求，仅发起该请求的钱包显示等待状态。
                const pending = connect.isPending && connect.variables?.connector === connector
                return (
                  <button
                    key={connector.uid}
                    className="flex items-center gap-3 rounded-[14px] border border-line bg-[#faf8fb] p-3.5 text-[14px] hover:border-[#edc8e3] aria-busy:border-[#edc8e3] aria-busy:opacity-100"
                    type="button"
                    disabled={connect.isPending}
                    aria-busy={pending}
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
                    {connector.icon ? (
                      <Image
                        src={connector.icon}
                        alt=""
                        width={30}
                        height={30}
                        unoptimized
                        className="size-[30px] shrink-0 rounded-[10px] object-contain"
                      />
                    ) : (
                      <span
                        className="grid size-[30px] shrink-0 place-items-center rounded-[10px] bg-[#f8dff1] text-[#d53ca6]"
                        aria-hidden="true"
                      >
                        ↗
                      </span>
                    )}
                    {connector.id === "injected" ? "浏览器钱包" : connector.name}
                    <span className="ml-auto flex shrink-0 items-center gap-2 text-muted">
                      {pending ? (
                        <>
                          <span
                            aria-hidden="true"
                            className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
                          />
                          连接中…
                        </>
                      ) : (
                        "→"
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-2.5 mb-3.5 text-[13px] leading-[1.8] text-muted">
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

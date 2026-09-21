"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type Address, formatUnits } from "viem"
import type { Snapshot } from "@/domains/bank/client"
import { explorerLink, targetChain } from "@/domains/wallet/config"
import { errors } from "@/shared/error-queue"
import { errorMessage, shortAddress } from "@/shared/web3"
import { transferOptions } from "./queries"

/** 先取得银行快照中的 Token/精度，再查询对应历史；索引记录不参与个人可提余额计算。 */
export function TransferHistory({
  account,
  snapshot,
  stopped = false,
}: {
  account?: Address
  snapshot?: Snapshot
  stopped?: boolean
}) {
  const [offset, setOffset] = useState(0)
  const client = useQueryClient()
  const options = transferOptions(
    {
      chainId: targetChain.id,
      token: snapshot?.token ?? "0x0000000000000000000000000000000000000000",
      account: account ?? "0x0000000000000000000000000000000000000000",
      decimals: snapshot?.decimals ?? 18,
    },
    offset
  )
  // 同时关闭自动启动和定时器，确保点击终止后，页面聚焦或重新联网也不会重启本查询。
  const history = useQuery({
    ...options,
    enabled: !!account && !!snapshot && !stopped,
    refetchInterval: stopped ? false : 15_000,
  })

  const records = history.isError ? undefined : history.data

  return (
    <section
      id="activity"
      className="mx-auto mt-14 max-w-[920px] border-t border-line pt-[26px] mobile:mt-9"
      aria-labelledby="activity-title"
    >
      <div className="flex items-center justify-between gap-4 [&_p]:mt-[7px] mobile:[&_h2]:text-[17px]">
        <div>
          <h2 id="activity-title">转账记录</h2>
          <p className="text-muted text-[12px]">你的 Token 动态，一目了然</p>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={!snapshot || history.isFetching || stopped}
          onClick={() => {
            const query = client.getQueryCache().find({ queryKey: options.queryKey })
            if (query) errors.recover(query.queryHash)
            void history.refetch()
          }}
        >
          {history.isFetching ? "刷新中…" : "刷新记录 ↻"}
        </button>
      </div>
      {!account || !snapshot ? (
        <div className="px-4 pt-9 pb-8 text-center text-[14px] text-[#8e8490]">
          <span
            aria-hidden="true"
            className="mb-3 inline-grid size-[38px] place-items-center rounded-full bg-[#faf5f9] text-[20px] text-[#c8a6bf]"
          >
            ↗
          </span>
          <p>{account ? "请先完成网络切换和合约余额读取" : "连接钱包，查看你的转账记录"}</p>
          <p className="mt-[7px] text-[12px] text-muted">
            存入、取出及该 Token 的其他转账都会显示在这里。
          </p>
        </div>
      ) : history.isError ? (
        <div className="notice error" role="alert">
          {errorMessage(history.error)}
          。可点击“刷新记录”重试，链上存取款仍可使用。
        </div>
      ) : !records ? (
        <p className="px-4 pt-9 pb-8 text-center text-[14px] text-[#8e8490]" role="status">
          {stopped ? "查询已暂停，恢复操作后再更新记录" : "正在查询转账记录…"}
        </p>
      ) : records.transfers.length === 0 ? (
        <div className="px-4 pt-9 pb-8 text-center text-[14px] text-[#8e8490]">
          <span
            aria-hidden="true"
            className="mb-3 inline-grid size-[38px] place-items-center rounded-full bg-[#faf5f9] text-[20px] text-[#c8a6bf]"
          >
            ↗
          </span>
          <p>{offset ? "本页暂无更多记录" : "还没有转账记录"}</p>
          <p className="mt-[7px] text-[12px] text-muted">
            交易确认后，等待索引服务同步即可在这里查看。
          </p>
        </div>
      ) : (
        <div className="mt-[22px] overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px] whitespace-nowrap [&_th]:py-2.5 [&_th]:pr-3 [&_th]:text-[11px] [&_th]:font-normal [&_th]:text-[#9a919d] [&_td]:border-t [&_td]:border-[#f4f2f5] [&_td]:py-[18px] [&_td]:pr-3.5 [&_th:last-child]:pr-0 [&_th:last-child]:text-right [&_td:last-child]:pr-0 [&_td:last-child]:text-right">
            <thead>
              <tr>
                <th>操作</th>
                <th>金额</th>
                <th>发送方 / 接收方</th>
                <th>区块</th>
                <th>交易</th>
              </tr>
            </thead>
            <tbody>
              {records.transfers.map((row) => {
                const outgoing = row.fromAddress.toLowerCase() === account.toLowerCase()
                const self = outgoing && row.toAddress.toLowerCase() === account.toLowerCase()
                return (
                  <tr key={`${row.transactionHash}:${row.logIndex}`}>
                    <td>
                      <span
                        className={`mr-2.5 inline-grid size-[30px] place-items-center rounded-full text-[16px] ${outgoing ? "bg-[#f8f5f9] text-[#9a8da1]" : "bg-[#f0f9f4] text-[#39997a]"}`}
                        aria-hidden="true"
                      >
                        {self ? "↔" : outgoing ? "↗" : "↙"}
                      </span>
                      {self ? "自转账" : outgoing ? "转出" : "转入"}
                    </td>
                    <td className={outgoing ? "" : "text-[#39997a]"}>
                      {self ? "" : outgoing ? "−" : "+"}
                      {formatUnits(BigInt(row.valueRaw), snapshot.decimals)}{" "}
                      <span className="text-muted">{snapshot.symbol}</span>
                    </td>
                    <td>
                      <a
                        href={explorerLink("address", row.fromAddress)}
                        title={row.fromAddress}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(row.fromAddress)}
                      </a>
                      <br />
                      <a
                        className="text-muted"
                        href={explorerLink("address", row.toAddress)}
                        title={row.toAddress}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(row.toAddress)}
                      </a>
                    </td>
                    <td className="text-muted">{row.blockNumber}</td>
                    <td>
                      <a
                        href={explorerLink("tx", row.transactionHash)}
                        title={row.transactionHash}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(row.transactionHash)}
                        {explorerLink("tx", row.transactionHash) ? " ↗" : ""}
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-[#f4f2f5] py-3 [&_p]:text-[11px]">
        <p className="text-[12px] text-muted">
          {records?.indexedThrough ? `已同步至区块 ${records.indexedThrough}` : "等待索引同步"} ·{" "}
          {stopped ? "已暂停" : "每 15 秒更新"}
        </p>
        <div className="flex items-center gap-3 text-[12px] text-[#8b808b] [&_button]:size-7 [&_button]:rounded-lg [&_button]:border-0 [&_button]:bg-[#faf8fb]">
          <button
            type="button"
            aria-label="上一页"
            disabled={stopped || !snapshot || offset === 0 || history.isFetching}
            onClick={() => setOffset(Math.max(0, offset - 10))}
          >
            ←
          </button>
          <span>{offset / 10 + 1}</span>
          <button
            type="button"
            aria-label="下一页"
            disabled={
              stopped ||
              !snapshot ||
              !records ||
              records.transfers.length < 10 ||
              history.isFetching
            }
            onClick={() => setOffset(offset + 10)}
          >
            →
          </button>
        </div>
      </div>
    </section>
  )
}

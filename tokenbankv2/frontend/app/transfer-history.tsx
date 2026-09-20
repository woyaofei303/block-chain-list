"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { type Address, formatUnits } from "viem"
import {
  errorMessage,
  loadTransfers,
  type Snapshot,
  shortAddress,
} from "@/lib/bank"
import { explorerLink, targetChain } from "@/lib/wagmi"

export function TransferHistory({
  account,
  snapshot,
}: {
  account?: Address
  snapshot?: Snapshot
}) {
  const [offset, setOffset] = useState(0)
  const history = useQuery({
    queryKey: [
      "transfers",
      targetChain.id,
      snapshot?.token,
      account,
      snapshot?.decimals,
      offset,
    ],
    enabled: !!account && !!snapshot,
    queryFn: () => {
      if (!account || !snapshot) throw new Error("请先连接钱包")
      return loadTransfers(
        "/api/transfers",
        {
          chainId: targetChain.id,
          token: snapshot.token,
          account,
          decimals: snapshot.decimals,
        },
        offset
      )
    },
    refetchInterval: 15_000,
  })
  const records = history.isError ? undefined : history.data

  return (
    <section
      id="activity"
      className="activity"
      aria-labelledby="activity-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="activity-title">转账记录</h2>
          <p className="muted small">你的 Token 动态，一目了然</p>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={!snapshot || history.isFetching}
          onClick={() => {
            void history.refetch()
          }}
        >
          {history.isFetching ? "刷新中…" : "刷新记录 ↻"}
        </button>
      </div>
      {!account || !snapshot ? (
        <div className="empty-state">
          <span aria-hidden="true">↗</span>
          <p>
            {account
              ? "请先完成网络切换和合约余额读取"
              : "连接钱包，查看你的转账记录"}
          </p>
          <p className="small muted">
            存入、取出及该 Token 的其他转账都会显示在这里。
          </p>
        </div>
      ) : history.isError ? (
        <div className="notice error" role="alert">
          {errorMessage(history.error)}
          。可点击“刷新记录”重试，链上存取款仍可使用。
        </div>
      ) : !records ? (
        <p className="empty-state" role="status">
          正在查询转账记录…
        </p>
      ) : records.transfers.length === 0 ? (
        <div className="empty-state">
          <span aria-hidden="true">↗</span>
          <p>{offset ? "本页暂无更多记录" : "还没有转账记录"}</p>
          <p className="small muted">
            交易确认后，等待索引服务同步即可在这里查看。
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
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
                const outgoing =
                  row.fromAddress.toLowerCase() === account.toLowerCase()
                const self =
                  outgoing &&
                  row.toAddress.toLowerCase() === account.toLowerCase()
                return (
                  <tr key={`${row.transactionHash}:${row.logIndex}`}>
                    <td>
                      <span
                        className={`transfer-icon ${outgoing ? "out" : "in"}`}
                        aria-hidden="true"
                      >
                        {self ? "↔" : outgoing ? "↗" : "↙"}
                      </span>
                      {self ? "自转账" : outgoing ? "转出" : "转入"}
                    </td>
                    <td className={outgoing ? "" : "incoming"}>
                      {self ? "" : outgoing ? "−" : "+"}
                      {formatUnits(BigInt(row.valueRaw), snapshot.decimals)}{" "}
                      <span className="muted">{snapshot.symbol}</span>
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
                        className="muted"
                        href={explorerLink("address", row.toAddress)}
                        title={row.toAddress}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddress(row.toAddress)}
                      </a>
                    </td>
                    <td className="muted">{row.blockNumber}</td>
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
      <div className="history-footer">
        <p className="small muted">
          {records?.indexedThrough
            ? `已同步至区块 ${records.indexedThrough}`
            : "等待索引同步"}{" "}
          · 每 15 秒更新
        </p>
        <div className="pagination">
          <button
            type="button"
            aria-label="上一页"
            disabled={!snapshot || offset === 0 || history.isFetching}
            onClick={() => setOffset(Math.max(0, offset - 10))}
          >
            ←
          </button>
          <span>{offset / 10 + 1}</span>
          <button
            type="button"
            aria-label="下一页"
            disabled={
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

import type { JSX } from "react"
import type { Intent } from "./client"

type OperationNoticeProps = {
  intent: Intent
  busy: boolean
  onVerify: () => void
  onContinue: () => void
  onNewOperation: () => void
}

export function OperationNotice({
  intent,
  busy,
  onVerify,
  onContinue,
  onNewOperation,
}: OperationNoticeProps): JSX.Element {
  return (
    <div className="notice info">
      <p className="break-all">操作编号：{intent.operationId}</p>
      <p>
        {intent.action === "deposit" ? "存款" : "取款"} {intent.amount} ·{" "}
        {intent.phase === "confirmed" ? "已确认" : "待核实"}
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" className="text-button" disabled={busy} onClick={onVerify}>
          核实结果
        </button>
        {intent.phase !== "confirmed" && (
          <button type="button" className="text-button" disabled={busy} onClick={onContinue}>
            使用原操作继续
          </button>
        )}
        {intent.phase === "confirmed" && (
          <button type="button" className="text-button" disabled={busy} onClick={onNewOperation}>
            新的一笔
          </button>
        )}
      </div>
    </div>
  )
}

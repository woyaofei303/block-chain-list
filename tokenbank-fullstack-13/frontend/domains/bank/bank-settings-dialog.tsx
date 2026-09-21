import { type JSX, useEffect, useRef, useState } from "react"
import { isAddress, zeroAddress } from "viem"
import { targetChain } from "@/domains/wallet/config"

type BankSettingsDialogProps = {
  bankAddress: string
  onBankChange: (address: string) => void
  onClose: () => void
}

/**
 * 工作区仅在打开时挂载弹窗，因此每次打开都从当前银行地址重新建立草稿。
 * 校验后由 onBankChange 更新页面地址，触发工作区 key 变化；取消关闭不会提交草稿。
 */
export function BankSettingsDialog({
  bankAddress,
  onBankChange,
  onClose,
}: BankSettingsDialogProps): JSX.Element {
  const [draft, setDraft] = useState(bankAddress)
  const [settingsError, setSettingsError] = useState("")
  const settings = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    settings.current?.showModal()
  }, [])

  return (
    <dialog ref={settings} onClose={onClose} className="modal" aria-labelledby="settings-title">
      <div className="flex items-center justify-between gap-4 [&_p]:mt-[7px] mobile:[&_h2]:text-[17px]">
        <h2 id="settings-title">银行合约设置</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭设置"
          onClick={() => settings.current?.close()}
        >
          ×
        </button>
      </div>
      <p className="my-3.5 text-[13px] leading-[1.8] text-muted">
        填写 {targetChain.name} 上的 TokenBank 地址。代币信息将从合约自动读取。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const value = draft.trim()
          if (!isAddress(value) || value === zeroAddress) {
            setSettingsError("请输入有效的银行合约地址")
            return
          }
          settings.current?.close()
          onBankChange(value)
        }}
      >
        <label className="mt-5 mb-2 block text-[13px]" htmlFor="bank-address">
          银行合约地址
        </label>
        <input
          className="w-full rounded-xl border border-[#e7e0ea] bg-[#fcfafc] p-3.5 text-[13px]"
          id="bank-address"
          placeholder="0x…"
          value={draft}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={!!settingsError}
          aria-describedby="settings-error"
        />
        <p className="mt-2.5 text-[12px] leading-[1.8] text-muted">
          请使用 TokenBank 地址，NFTMarket 和 Token 地址无法用于存取款。
        </p>
        <p
          id="settings-error"
          className="text-[12px] wrap-anywhere text-[#bc3654] not-empty:px-1 not-empty:py-2.5"
          role={settingsError ? "alert" : undefined}
        >
          {settingsError}
        </p>
        <button className="primary-button mt-4" type="submit">
          保存合约
        </button>
      </form>
    </dialog>
  )
}

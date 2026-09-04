"use client"

import { useRef, useState } from "react"

type ComposerProps = {
  sending: boolean
  streaming: boolean
  onSend: (content: string) => Promise<void>
  onStop: () => void
}

/** 文本输入属于完整聊天用例，同时受发送请求和生成状态约束。 */
export function Composer({
  sending,
  streaming,
  onSend,
  onStop,
}: ComposerProps) {
  const [content, setContent] = useState("")
  const textarea = useRef<HTMLTextAreaElement>(null)
  const disabled =
    sending || streaming || !content.trim() || content.length > 32_000

  async function submit() {
    if (disabled) return
    const value = content
    setContent("")
    if (textarea.current) textarea.current.style.height = "auto"
    try {
      await onSend(value)
    } catch {
      setContent(value)
    }
  }

  return (
    <div className="shrink-0 bg-gradient-to-t from-[var(--canvas)] via-[var(--canvas)] to-transparent px-3 pb-4 pt-6 sm:px-6 sm:pb-6">
      <div className="mx-auto max-w-3xl">
        <div className="relative rounded-[1.6rem] border border-[var(--border-strong)] bg-[var(--composer)] shadow-[0_8px_30px_rgba(0,0,0,0.08)] focus-within:border-[var(--muted)]">
          <textarea
            ref={textarea}
            rows={1}
            value={content}
            placeholder="给 Multi Chat 发送消息"
            className="max-h-48 min-h-14 w-full resize-none bg-transparent px-5 py-4 pr-16 text-[15px] leading-6 outline-none placeholder:text-[var(--muted)]"
            onChange={(event) => {
              setContent(event.target.value)
              event.target.style.height = "auto"
              event.target.style.height = `${Math.min(event.target.scrollHeight, 192)}px`
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          {streaming ? (
            <button
              type="button"
              className="absolute bottom-2.5 right-2.5 grid size-9 place-items-center rounded-full bg-[var(--text)] text-[var(--canvas)] transition hover:opacity-80"
              onClick={onStop}
              aria-label="停止生成"
            >
              <span className="size-3 rounded-sm bg-current" />
            </button>
          ) : (
            <button
              type="button"
              className="absolute bottom-2.5 right-2.5 grid size-9 place-items-center rounded-full bg-[var(--text)] text-lg text-[var(--canvas)] transition enabled:hover:opacity-80 disabled:opacity-25"
              onClick={() => void submit()}
              disabled={disabled}
              aria-label="发送消息"
            >
              ↑
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
          模型可能会出错，请核对重要信息
        </p>
      </div>
    </div>
  )
}

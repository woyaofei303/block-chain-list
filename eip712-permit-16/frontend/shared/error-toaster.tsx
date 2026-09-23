"use client"

import { useEffect, useSyncExternalStore } from "react"
import { Toaster, toast } from "sonner"
import { type ErrorNotice, errors } from "./error-queue"

const empty: ErrorNotice[] = []
/** 全局只挂载一次；队列负责合并和容量，这里负责将队首显示为 Sonner 提示。 */
export function ErrorToaster() {
  const notices = useSyncExternalStore(errors.subscribe, errors.snapshot, () => empty)
  const current = notices[0]
  useEffect(() => {
    if (!current) return
    const id = `request-error-${current.id}`
    const close = () => errors.dismiss(current.id)
    toast.error(current.error.message, {
      id,
      description: current.count > 1 ? `相同错误已发生 ${current.count} 次` : undefined,
      duration: Infinity,
      closeButton: true,
      onDismiss: close,
    })
    // 队列自行计时，合并计数不会重置 5 秒期限；切换时清理旧提示。
    const timer =
      current.error.severity === 0
        ? setTimeout(close, Math.max(0, 5_000 - (Date.now() - (current.shownAt ?? Date.now()))))
        : undefined
    return () => {
      clearTimeout(timer)
      toast.dismiss(id)
    }
  }, [current])
  return (
    <Toaster
      visibleToasts={1}
      position="top-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full gap-3 rounded-xl border border-rose-200 bg-white p-4 text-sm text-slate-900 shadow-lg",
          description: "mt-1 text-xs text-slate-500",
          closeButton: "rounded border border-slate-200 bg-white p-1",
        },
      }}
    />
  )
}

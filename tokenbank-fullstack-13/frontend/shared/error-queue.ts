import { type AppError, asAppError } from "./errors.ts"

export type ErrorNotice = {
  id: number
  key: string
  error: AppError
  count: number
  shownAt?: number
}
/** items[0] 正在展示，其余等待；总容量为 3，ErrorToaster 只消费队首。 */
export class ErrorQueue {
  private items: ErrorNotice[] = []
  private sequence = 0
  // source 标识哪一个查询/写操作失败，key 标识可合并的错误；恢复时只解除相关故障的抑制。
  private faults = new Map<string, string>()
  private muted = new Set<string>()
  private listeners = new Set<() => void>()
  snapshot = () => this.items
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish() {
    this.items = [...this.items]
    if (this.items[0] && this.items[0].shownAt === undefined)
      this.items[0] = { ...this.items[0], shownAt: Date.now() }
    for (const listener of this.listeners) listener()
  }
  report(cause: unknown, source: string, explicit = false) {
    const error = asAppError(cause)
    if (error.kind === "cancelled") return
    const key = `${error.code}:${error.message.trim().replace(/\s+/g, " ")}`
    this.faults.set(source, key)
    if (explicit) this.muted.delete(key)
    if (this.muted.has(key)) return
    const existing = this.items.findIndex((item) => item.key === key)
    if (existing >= 0) {
      const item = this.items[existing]
      this.items[existing] = {
        ...item,
        count: item.count + 1,
        error: error.severity > item.error.severity ? error : item.error,
      }
    } else {
      if (this.items.length === 3) {
        // 只从等待项挑出最低等级、最晚到达的一条；新错误更严重才替换，当前提示不被打断。
        const candidates = this.items
          .slice(1)
          .sort((a, b) => a.error.severity - b.error.severity || b.id - a.id)
        const worst = candidates[0]
        if (error.severity <= worst.error.severity) {
          this.muted.add(key)
          return
        }
        this.muted.add(worst.key)
        this.items = this.items.filter((item) => item.id !== worst.id)
      }
      this.items.push({ id: ++this.sequence, key, error, count: 1 })
    }
    // 显示中的提示不被抢占，只重排等待项。
    const [current, ...waiting] = this.items
    this.items = [
      current,
      ...waiting.sort((a, b) => b.error.severity - a.error.severity || a.id - b.id),
    ]
    this.publish()
  }
  dismiss(id: number) {
    // 自动到期和手动关闭可能重复回调；旧 id 不得继续移除下一条提示。
    if (this.items[0]?.id !== id) return
    if ([...this.faults.values()].includes(this.items[0].key)) this.muted.add(this.items[0].key)
    this.items = this.items.slice(1)
    this.publish()
  }
  recover(source: string) {
    const key = this.faults.get(source)
    if (key) this.muted.delete(key)
    this.faults.delete(source)
  }
  clear() {
    this.items = []
    this.faults.clear()
    this.muted.clear()
    this.publish()
  }
}
export const errors = new ErrorQueue()

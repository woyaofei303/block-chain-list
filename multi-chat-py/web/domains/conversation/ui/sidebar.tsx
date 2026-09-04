/** ConversationSummary 的导航视图；所有写操作通过回调交还 ChatShell 编排。 */
import type { ConversationSummary } from "../model.ts"

type SidebarProps = {
  conversations: ConversationSummary[]
  activeId: string | null
  mobileOpen: boolean
  collapsed: boolean
  onClose: () => void
  onNew: () => void
  onSelect: (id: string) => void
  onRename: (conversation: ConversationSummary) => void
  onDelete: (conversation: ConversationSummary) => void
}

export function Sidebar(props: SidebarProps) {
  return (
    <>
      {props.mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          aria-label="关闭侧栏"
          onClick={props.onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] transition-all duration-200 md:static md:z-auto ${
          props.mobileOpen
            ? "translate-x-0"
            : "-translate-x-full md:translate-x-0"
        } ${props.collapsed ? "md:-ml-72" : "md:ml-0"}`}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="grid size-8 place-items-center rounded-xl bg-[var(--text)] text-sm font-bold text-[var(--canvas)]">
              M
            </span>
            Multi Chat
          </div>
          <button
            type="button"
            className="icon-button grid md:hidden"
            onClick={props.onClose}
            aria-label="关闭侧栏"
          >
            ×
          </button>
        </div>
        <div className="px-3 pb-3">
          <button
            type="button"
            className="flex h-10 w-full items-center gap-3 rounded-xl border border-[var(--border)] px-3 text-sm font-medium transition hover:bg-[var(--hover)]"
            onClick={props.onNew}
          >
            <span className="text-xl font-light">＋</span>
            新对话
          </button>
        </div>
        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
          aria-label="会话历史"
        >
          <p className="px-3 pb-2 pt-2 text-xs font-medium text-[var(--muted)]">
            最近对话
          </p>
          {props.conversations.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-[var(--muted)]">
              暂无历史
            </p>
          )}
          {props.conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`group relative mb-1 rounded-xl transition ${
                conversation.id === props.activeId
                  ? "bg-[var(--active)]"
                  : "hover:bg-[var(--hover)]"
              }`}
            >
              <button
                type="button"
                className="w-full truncate px-3 py-2.5 pr-20 text-left text-sm"
                onClick={() => props.onSelect(conversation.id)}
                title={conversation.title}
              >
                {conversation.title}
              </button>
              <div className="absolute inset-y-0 right-2 hidden items-center gap-1 group-hover:flex group-focus-within:flex">
                <button
                  type="button"
                  className="icon-button grid size-7 text-xs"
                  aria-label={`重命名 ${conversation.title}`}
                  onClick={() => props.onRename(conversation)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-button grid size-7 text-base"
                  aria-label={`删除 ${conversation.title}`}
                  onClick={() => props.onDelete(conversation)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-[var(--border)] p-4 text-xs leading-5 text-[var(--muted)]">
          历史仅保存在本机
        </div>
      </aside>
    </>
  )
}

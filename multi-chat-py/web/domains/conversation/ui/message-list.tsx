"use client"

import {
  isValidElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import type { ChatMessage, Conversation } from "../model.ts"

type MessageListProps = {
  conversation: Conversation | null | undefined
  loading: boolean
  retrying: boolean
  onRetry: (messageId: string) => void
}

export function MessageList({
  conversation,
  loading,
  retrying,
  onRetry,
}: MessageListProps) {
  const container = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  const latestContent = conversation?.messages.at(-1)?.content

  // 只有用户仍停留在底部附近时才跟随流式输出，向上阅读历史时不抢滚动位置。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 内容变化就是触发本次滚动的信号。
  useEffect(() => {
    if (followOutput.current && container.current) {
      container.current.scrollTop = container.current.scrollHeight
    }
  }, [latestContent])

  return (
    <div
      ref={container}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={(event) => {
        const element = event.currentTarget
        followOutput.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < 100
      }}
    >
      {loading ? (
        <div className="grid h-full place-items-center text-sm text-[var(--muted)]">
          正在载入…
        </div>
      ) : !conversation || conversation.messages.length === 0 ? null : (
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
          {conversation.messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              retrying={retrying}
              onRetry={onRetry}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Message({
  message,
  retrying,
  onRetry,
}: {
  message: ChatMessage
  retrying: boolean
  onRetry: (id: string) => void
}) {
  const [copied, setCopied] = useState(false)
  if (message.role === "user") {
    return (
      <div className="mb-8 flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-[var(--bubble)] px-5 py-3 text-[15px] leading-6 sm:max-w-[75%]">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <article
      className="group mb-10 grid grid-cols-[2rem_minmax(0,1fr)] gap-3"
      aria-live={message.status === "streaming" ? "polite" : undefined}
    >
      <div className="mt-0.5 grid size-8 place-items-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-xs font-bold">
        M
      </div>
      <div className="min-w-0">
        {message.content ? (
          <div className="markdown text-[15px] leading-7">
            {/* 未启用 rehype-raw：模型输出中的原始 HTML 不会作为页面节点执行。 */}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: CodeBlock,
                a: ({ children, ...props }) => (
                  <a {...props} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
            {message.status === "streaming" && (
              <span className="stream-cursor" />
            )}
          </div>
        ) : message.status === "streaming" ? (
          <div
            className="flex h-7 items-center gap-1"
            role="status"
            aria-label="正在生成"
          >
            <span className="thinking-dot" />
            <span className="thinking-dot [animation-delay:150ms]" />
            <span className="thinking-dot [animation-delay:300ms]" />
          </div>
        ) : null}
        <div className="mt-2 flex min-h-7 items-center gap-2 text-xs text-[var(--muted)]">
          {message.content && message.status !== "streaming" && (
            <button
              type="button"
              className="rounded-lg px-2 py-1 transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              onClick={async () => {
                await navigator.clipboard.writeText(message.content)
                setCopied(true)
                setTimeout(() => setCopied(false), 1_500)
              }}
            >
              {copied ? "已复制" : "复制"}
            </button>
          )}
          {(message.status === "failed" || message.status === "stopped") && (
            <>
              <span>{message.status === "failed" ? "回答中断" : "已停止"}</span>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
                onClick={() => onRetry(message.id)}
                disabled={retrying}
              >
                重试
              </button>
            </>
          )}
          {message.model && message.status !== "streaming" && (
            <span className="ml-auto opacity-0 transition group-hover:opacity-100">
              {message.model}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const code = nodeText(children).replace(/\n$/, "")
  return (
    <div className="code-block">
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1_500)
        }}
      >
        {copied ? "已复制" : "复制代码"}
      </button>
      <pre>{children}</pre>
    </div>
  )
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children)
  }
  return ""
}

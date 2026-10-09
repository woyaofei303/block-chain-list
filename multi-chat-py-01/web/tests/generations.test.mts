import assert from "node:assert/strict"
import test from "node:test"

import {
  createGenerationBuffer,
  createGenerationManager,
} from "../domains/generation/server/manager.ts"

// 先保存多个事件，再带旧游标回放，检查只返回后续片段。
test("replays only events newer than the last applied event id", () => {
  const generation = createGenerationBuffer("generation-1")
  generation.publish("delta", { text: "你" })
  generation.publish("delta", { text: "好" })
  generation.publish("done", { messageId: "message-1" })

  assert.deepEqual(
    generation.eventsAfter(1).map(({ id, type }) => ({ id, type })),
    [
      { id: 2, type: "delta" },
      { id: 3, type: "done" },
    ]
  )
  assert.deepEqual(generation.eventsAfter(3), [])
})

// 订阅实时事件后发终态，检查通知只发生一次，结束后不再追加内容。
test("delivers live events once and closes after a terminal event", () => {
  const generation = createGenerationBuffer("generation-1")
  const received: number[] = []
  const unsubscribe = generation.subscribe((event) => received.push(event.id))

  generation.publish("delta", { text: "A" })
  generation.publish("done", {})
  generation.publish("delta", { text: "ignored" })
  unsubscribe()

  assert.deepEqual(received, [1, 2])
  assert.equal(generation.terminal, true)
})

// 假模型先输出部分文本再抛错，检查部分内容和 failed 状态都会持久化。
test("keeps partial text and marks the answer failed when upstream stops", async () => {
  const updates: Array<{
    content: string
    status: string
    lastEventId: number
  }> = []
  const manager = createGenerationManager({
    /** 先给出部分正文再断流，模拟模型输出中途失败，不能把两次模型回答拼接。 */
    async *stream() {
      yield "部分"
      throw new Error("upstream disconnected")
    },
    // 收集每次持久化快照，断言最终状态和部分正文一起保留。
    async persist(_generationId, update) {
      updates.push(update)
    },
  })

  manager.start({ id: "generation-1", messages: [] })
  await manager.finished("generation-1")

  assert.deepEqual(
    manager
      .get("generation-1")
      ?.eventsAfter(0)
      .map(({ type }) => type),
    ["delta", "error"]
  )
  assert.deepEqual(updates.at(-1), {
    content: "部分",
    status: "failed",
    lastEventId: 2,
  })
})

// 假模型输出后等待取消，检查停止能打断上游并保存已生成的文字。
test("stopping a generation aborts upstream and preserves partial text", async () => {
  const updates: Array<{
    content: string
    status: string
    lastEventId: number
  }> = []
  const manager = createGenerationManager({
    /** 产生一段正文后只等待 abort，用来确认停止信号确实传到模型边界。 */
    async *stream(_messages, signal) {
      yield "已生成"
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      )
    },
    // 收集每次持久化快照，断言最终状态和部分正文一起保留。
    async persist(_generationId, update) {
      updates.push(update)
    },
  })

  manager.start({ id: "generation-1", messages: [] })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(manager.stop("generation-1"), true)
  await manager.finished("generation-1")

  assert.equal(updates.at(-1)?.content, "已生成")
  assert.equal(updates.at(-1)?.status, "stopped")
  assert.deepEqual(
    manager
      .get("generation-1")
      ?.eventsAfter(0)
      .map(({ type }) => type),
    ["delta", "stopped"]
  )
})

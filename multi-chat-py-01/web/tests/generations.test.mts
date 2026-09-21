import assert from "node:assert/strict"
import test from "node:test"

import {
  createGenerationBuffer,
  createGenerationManager,
} from "../domains/generation/server/manager.ts"

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

test("keeps partial text and marks the answer failed when upstream stops", async () => {
  const updates: Array<{
    content: string
    status: string
    lastEventId: number
  }> = []
  const manager = createGenerationManager({
    async *stream() {
      yield "部分"
      throw new Error("upstream disconnected")
    },
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

test("stopping a generation aborts upstream and preserves partial text", async () => {
  const updates: Array<{
    content: string
    status: string
    lastEventId: number
  }> = []
  const manager = createGenerationManager({
    async *stream(_messages, signal) {
      yield "已生成"
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        })
      )
    },
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

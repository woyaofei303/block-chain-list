import assert from "node:assert/strict"
import test from "node:test"

import type { ChatMessage } from "../domains/conversation/model.ts"
import { applyGenerationEvent } from "../features/chat/client/apply-generation-event.ts"

test("ignores replayed stream events already applied by the client", () => {
  const message: ChatMessage = {
    id: "message-1",
    role: "assistant",
    content: "",
    status: "streaming",
    generationId: "generation-1",
    lastEventId: 0,
    createdAt: "2026-09-03T00:00:00.000Z",
  }
  const event = { id: 1, type: "delta" as const, data: { text: "你好" } }

  const applied = applyGenerationEvent(message, event)
  const replayed = applyGenerationEvent(applied, event)

  assert.equal(replayed.content, "你好")
  assert.equal(replayed.lastEventId, 1)
  assert.equal(replayed, applied)
})

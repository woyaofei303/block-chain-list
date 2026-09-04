import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { createConversationStore } from "../domains/conversation/server/store.ts"
import { createGenerationManager } from "../domains/generation/server/manager.ts"
import { createChatService } from "../features/chat/server/service.ts"

test("a repeated send request reuses the generation without calling the model twice", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "multi-chat-service-"))
  t.after(() => rm(directory, { recursive: true }))
  const store = createConversationStore({
    storePath: path.join(directory, "chat-store.json"),
    legacyPath: path.join(directory, "missing-legacy.json"),
  })
  const conversation = await store.createConversation()
  let modelCalls = 0
  const generations = createGenerationManager({
    async *stream() {
      modelCalls += 1
      yield "回答"
    },
    persist(generationId, update) {
      return store.updateAssistant(generationId, update)
    },
  })
  const chat = createChatService({
    store,
    generations,
    getModel: () => "test-model",
  })
  const input = { content: "问题", requestKey: "same-request" }

  const first = await chat.sendMessage(conversation.id, input)
  await generations.finished(first.generationId)
  const repeated = await chat.sendMessage(conversation.id, input)

  assert.equal(first.reused, false)
  assert.equal(repeated.reused, true)
  assert.equal(repeated.generationId, first.generationId)
  assert.equal(modelCalls, 1)
})

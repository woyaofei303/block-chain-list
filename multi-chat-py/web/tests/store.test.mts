import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { createConversationStore } from "../domains/conversation/server/store.ts"

test("imports valid Python history exactly once", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "multi-chat-"))
  const storePath = path.join(directory, "chat-store.json")
  const legacyPath = path.join(directory, "chat_history.json")
  await writeFile(
    legacyPath,
    JSON.stringify([
      { role: "user", content: "世界最高峰是什么？" },
      { role: "assistant", content: "珠穆朗玛峰。" },
    ])
  )

  const store = createConversationStore({
    storePath,
    legacyPath,
    now: () => "2026-09-03T00:00:00.000Z",
    createId: () => "fixed-id",
  })

  const conversations = await store.listConversations()
  assert.equal(conversations.length, 1)
  assert.equal(conversations[0]?.title, "世界最高峰是什么？")
  assert.equal(conversations[0]?.messages.length, 2)

  await writeFile(
    legacyPath,
    JSON.stringify([{ role: "user", content: "不应重复导入" }])
  )
  const restarted = createConversationStore({
    storePath,
    legacyPath,
    now: () => "2026-09-04T00:00:00.000Z",
    createId: () => "another-id",
  })

  assert.equal((await restarted.listConversations()).length, 1)
  assert.equal(
    JSON.parse(await readFile(storePath, "utf8")).legacyImportedAt,
    "2026-09-03T00:00:00.000Z"
  )
})

test("reusing a request key returns the existing turn", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "multi-chat-"))
  let nextId = 0
  const store = createConversationStore({
    storePath: path.join(directory, "chat-store.json"),
    legacyPath: path.join(directory, "missing-history.json"),
    now: () => "2026-09-03T00:00:00.000Z",
    createId: () => `id-${++nextId}`,
  })
  const conversation = await store.createConversation()

  const first = await store.addUserTurn(conversation.id, {
    content: "你好",
    requestKey: "request-1",
    model: "test-model",
  })
  const duplicate = await store.addUserTurn(conversation.id, {
    content: "你好",
    requestKey: "request-1",
    model: "test-model",
  })

  assert.equal(duplicate.reused, true)
  assert.equal(duplicate.generationId, first.generationId)
  assert.equal(
    (await store.getConversation(conversation.id))?.messages.length,
    2
  )
})

test("retry replaces a partial assistant answer instead of appending", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "multi-chat-"))
  let nextId = 0
  const store = createConversationStore({
    storePath: path.join(directory, "chat-store.json"),
    legacyPath: path.join(directory, "missing-history.json"),
    now: () => "2026-09-03T00:00:00.000Z",
    createId: () => `id-${++nextId}`,
  })
  const conversation = await store.createConversation()
  const turn = await store.addUserTurn(conversation.id, {
    content: "请回答",
    requestKey: "request-1",
    model: "test-model",
  })
  await store.updateAssistant(turn.generationId, {
    content: "不完整",
    lastEventId: 2,
    status: "failed",
  })

  const retried = await store.retryAssistant(conversation.id, {
    assistantMessageId: turn.assistantMessageId,
    requestKey: "request-2",
    model: "new-model",
  })
  const updated = await store.getConversation(conversation.id)

  assert.notEqual(retried.generationId, turn.generationId)
  assert.equal(retried.assistantMessageId, turn.assistantMessageId)
  assert.equal(updated?.messages.length, 2)
  assert.deepEqual(updated?.messages[1], {
    ...updated?.messages[1],
    content: "",
    status: "streaming",
    model: "new-model",
    generationId: retried.generationId,
    requestKey: "request-2",
    lastEventId: 0,
  })
})

test("marks an interrupted generation as failed after restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "multi-chat-"))
  const storePath = path.join(directory, "chat-store.json")
  let nextId = 0
  const options = {
    storePath,
    legacyPath: path.join(directory, "missing-history.json"),
    now: () => "2026-09-03T00:00:00.000Z",
    createId: () => `id-${++nextId}`,
  }
  const store = createConversationStore(options)
  const conversation = await store.createConversation()
  await store.addUserTurn(conversation.id, {
    content: "不要丢失这条消息",
    requestKey: "request-1",
    model: "test-model",
  })

  const restarted = createConversationStore(options)
  const recovered = await restarted.getConversation(conversation.id)

  assert.equal(recovered?.messages[1]?.status, "failed")
})

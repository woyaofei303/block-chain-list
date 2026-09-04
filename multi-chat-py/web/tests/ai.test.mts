import assert from "node:assert/strict"
import test from "node:test"

import { parseOpenAiStream } from "../domains/generation/server/openai-compatible.ts"

test("parses OpenAI-compatible SSE across arbitrary network chunks", async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n')
      )
      controller.enqueue(
        encoder.encode(
          '\ndata: {"choices":[{"delta":{"content":"好"}}]}\r\n\r\n'
        )
      )
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })

  const chunks: string[] = []
  for await (const chunk of parseOpenAiStream(stream)) chunks.push(chunk)

  assert.deepEqual(chunks, ["你", "好"])
})

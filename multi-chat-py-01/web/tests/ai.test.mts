import assert from "node:assert/strict"
import test from "node:test"

import { parseOpenAiStream } from "../domains/generation/server/openai-compatible.ts"

// 把“你好”的 SSE 事件拆到不同网络分块，检查解析器拼回完整事件后才输出文本。
test("parses OpenAI-compatible SSE across arbitrary network chunks", async () => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    /** 故意在 SSE 的空行处拆分网络块，检查缓冲解析不依赖每次 read 恰好对应完整事件。 */
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

// 最后一条事件没有标准结束空行时仍读取尾部，兼容流正常结束但格式略有差异的服务。
test("parses the final event when a compatible provider omits the trailing blank line", async () => {
  const stream = new Blob([
    'data: {"choices":[{"delta":{"content":"完整"}}]}',
  ]).stream()

  const chunks: string[] = []
  for await (const chunk of parseOpenAiStream(stream)) chunks.push(chunk)

  assert.deepEqual(chunks, ["完整"])
})

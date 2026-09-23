import assert from "node:assert/strict"
import { test } from "node:test"
import { ErrorQueue } from "../shared/error-queue.ts"
import { AppError } from "../shared/errors.ts"

test("错误合并计数、容量含当前最多 3 条、优先保留严重错误及关闭后故障抑制", () => {
  const q = new ErrorQueue()
  const error = (code: string, severity: 0 | 1 | 2 = 0) =>
    new AppError("business", code, code, { severity })
  q.report(error("network"), "a")
  const first = q.snapshot()[0]
  q.report(error("network"), "b")
  assert.equal(q.snapshot()[0].count, 2)
  q.report(error("low"), "low")
  q.report(error("medium", 1), "medium")
  q.report(error("critical", 2), "critical")
  assert.deepEqual(
    q.snapshot().map((e) => e.error.code),
    ["network", "critical", "medium"]
  )
  q.dismiss(first.id)
  q.dismiss(first.id)
  assert.equal(q.snapshot()[0].error.code, "critical")
  q.report(error("network"), "a")
  q.report(error("low"), "low")
  assert.equal(q.snapshot().length, 2)
  q.recover("unrelated")
  q.report(error("network"), "a")
  assert.equal(q.snapshot().length, 2)
  q.recover("a")
  q.report(error("network"), "a")
  assert.equal(q.snapshot().length, 3)
  while (q.snapshot().length) q.dismiss(q.snapshot()[0].id)
  assert.deepEqual(q.snapshot(), [])
})

test("同等级先进先出，合并不重置计时，恢复和主动新操作允许重新提示", () => {
  const q = new ErrorQueue()
  const fault = new AppError("network", "OFFLINE", " 网络  失败 ", { requestId: "first" })
  q.report(fault, "poll")
  const first = q.snapshot()[0]
  q.report(new AppError("network", "OFFLINE", "网络 失败", { requestId: "different" }), "poll")
  assert.equal(q.snapshot()[0].count, 2)
  assert.equal(q.snapshot()[0].shownAt, first.shownAt)
  q.report(new AppError("http", "A", "a"), "a")
  q.report(new AppError("http", "B", "b"), "b")
  q.report(new AppError("http", "C", "c"), "c")
  assert.deepEqual(
    q.snapshot().map((item) => item.error.code),
    ["OFFLINE", "A", "B"]
  )
  q.recover("poll")
  q.dismiss(first.id)
  q.report(fault, "poll")
  assert.equal(q.snapshot().length, 3)
  q.dismiss(q.snapshot()[0].id)
  q.dismiss(q.snapshot()[0].id)
  q.dismiss(q.snapshot()[0].id)
  q.report(fault, "poll")
  assert.equal(q.snapshot().length, 0)
  q.report(fault, "user-action", true)
  assert.equal(q.snapshot().length, 1)
  q.report(new DOMException("cancelled", "AbortError"), "abort")
  assert.equal(q.snapshot().length, 1)
})

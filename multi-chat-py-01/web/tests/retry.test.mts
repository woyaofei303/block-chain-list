import assert from "node:assert/strict"
import test from "node:test"

import { fullJitterDelay, isRetryableStatus } from "../shared/retry.ts"

test("uses capped exponential backoff with full jitter", () => {
  assert.equal(
    fullJitterDelay(0, () => 0.5),
    250
  )
  assert.equal(
    fullJitterDelay(4, () => 0.5),
    4_000
  )
  assert.equal(
    fullJitterDelay(20, () => 1),
    8_000
  )
  assert.equal(isRetryableStatus(429), true)
  assert.equal(isRetryableStatus(401), false)
})

import assert from "node:assert/strict"
import test from "node:test"

import { eccRoundTrip, mine, rsaRoundTrip, sha256Hex } from "./main.mjs"

test("PoW、RSA 和 ECC", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  )

  const pow = mine("test", 2)
  assert.ok(pow.hash.startsWith("00"))
  assert.equal(pow.hash, sha256Hex(`test${pow.nonce}`))

  for (const result of [rsaRoundTrip("test1"), eccRoundTrip("test1")]) {
    assert.equal(result.verified, true)
    assert.equal(result.tamperedVerified, false)
  }
})

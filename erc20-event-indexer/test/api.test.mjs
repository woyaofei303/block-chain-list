import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createApp } from '../src/app.mjs'

const token = `0x${'a'.repeat(40)}`
const alice = `0x${'1'.repeat(40)}`
const bob = `0x${'2'.repeat(40)}`

test('API 先校验参数，异步数据库错误统一返回 JSON 且不泄漏内部信息', async (t) => {
  let queries = 0
  const db = {
    async query() {
      queries += 1
      throw new Error('private database connection details')
    },
  }
  const app = createApp(
    db,
    { chainId: 31337, tokenAddress: token },
    { symbol: 'TEST', decimals: 18 },
  )
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  for (const query of [
    '',
    `address=${alice}&address=${bob}`,
    `address=${alice}&limit=1&limit=2`,
    `address=${alice}&offset=0&offset=1`,
  ]) {
    const response = await fetch(`${base}/transfers?${query}`)
    assert.equal(response.status, 400)
    assert.match(response.headers.get('content-type'), /application\/json/)
  }
  const unknown = await fetch(`${base}/missing`)
  assert.equal(unknown.status, 404)
  assert.deepEqual(await unknown.json(), { error: 'Not found' })
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    const response = await fetch(`${base}/transfers?address=${alice}`, {
      method,
    })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET')
  }
  assert.equal(queries, 0)
  const failure = await fetch(`${base}/transfers?address=${alice}`)
  assert.equal(failure.status, 500)
  assert.deepEqual(await failure.json(), { error: 'Database query failed' })
  assert.equal(queries, 1)
})

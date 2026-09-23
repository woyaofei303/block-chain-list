import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  type EIP1193Provider,
  erc20Abi,
  type Hex,
  http,
  numberToHex,
  parseAbi,
  parseEther,
  zeroHash,
} from 'viem'
import { foundry } from 'viem/chains'
import { createSiweMessage } from 'viem/siwe'
import { GET as forwardOperation } from '../../frontend/app/api/backend/[...path]/route.ts'
import { GET } from '../../frontend/app/api/transfers/route.ts'
import { createBank } from '../../frontend/domains/bank/client.ts'
import {
  executeIntent,
  type Intent,
} from '../../frontend/domains/operations/client.ts'
import { loadTransfers } from '../../frontend/domains/transfers/client.ts'
import { createApp } from '../src/app.ts'
import { operationAbi } from '../src/operations/chain.ts'
import { createOperationsRouter } from '../src/operations/router.ts'
import { scanOnce } from '../src/transfers/indexer.ts'
import { initDatabase } from '../src/transfers/repository.ts'
import type { TransferResponse } from '../src/transfers/types.ts'

const usePermit = process.env.TEST_PERMIT === '1'

test(`${usePermit ? 'Permit' : 'Approve'}：本项目合约 → 存取款 → PostgreSQL → Express → 前端代理与记录形成闭环`, {
  timeout: 60_000,
}, async (t) => {
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const reservedAddress = reservation.address()
  assert.ok(reservedAddress && typeof reservedAddress !== 'string')
  const port = reservedAddress.port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const anvil = spawn(
    'anvil',
    ['--host', '127.0.0.1', '--port', String(port), '--silent'],
    { stdio: 'ignore' },
  )
  // 立即独立注册：配置解析或数据库清理失败也必须回收自己的节点。
  t.after(async () => {
    if (anvil.exitCode === null && anvil.signalCode === null) {
      const stopped = once(anvil, 'exit')
      anvil.kill()
      await stopped
    }
  })
  const schema = `tokenbank_fullstack_${process.pid}_${Date.now()}`
  // pg 会优先读取连接串中的 options，测试必须保留自己的 search_path。
  const connectionString = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : undefined
  connectionString?.searchParams.delete('options')
  const database = {
    connectionString: connectionString?.href,
    database: process.env.PGDATABASE || 'postgres',
  }
  const admin = new pg.Pool(database)
  const db = new pg.Pool({ ...database, options: `-c search_path=${schema}` })
  const previousIndexer = process.env.INDEXER_URL
  let schemaCreated = false
  let server: Server | undefined
  t.after(async () => {
    if (previousIndexer === undefined) delete process.env.INDEXER_URL
    else process.env.INDEXER_URL = previousIndexer
    const activeServer = server
    if (activeServer)
      await new Promise<void>((resolve) => activeServer.close(() => resolve()))
    await db.end()
    try {
      if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    } finally {
      await admin.end()
    }
  })
  const transport = http(`http://127.0.0.1:${port}`, { retryCount: 0 })
  const rpc = createPublicClient({
    transport,
    chain: foundry,
    pollingInterval: 20,
    cacheTime: 0,
  })
  const wallet = createWalletClient({ transport, chain: foundry })
  for (let attempt = 0; ; attempt++) {
    try {
      await rpc.getChainId()
      break
    } catch (error) {
      if (attempt >= 40) throw error
      await sleep(50)
    }
  }
  const [deployer, account, other] = await wallet.getAddresses()
  const contracts = fileURLToPath(new URL('../../contracts/', import.meta.url))
  const bytecode = (name: string): Hex =>
    execFileSync(
      'forge',
      ['inspect', `src/${name}.sol:${name}`, 'bytecode', '--root', contracts],
      { encoding: 'utf8' },
    ).trim() as Hex
  const tokenReceipt = await rpc.waitForTransactionReceipt({
    hash: await wallet.deployContract({
      account: deployer,
      abi: [],
      bytecode: bytecode(usePermit ? 'JulianToken' : 'BaseERC20'),
    }),
  })
  const token = tokenReceipt.contractAddress
  assert.ok(token)
  const bankReceipt = await rpc.waitForTransactionReceipt({
    hash: await wallet.deployContract({
      account: deployer,
      abi: parseAbi(['constructor(address tokenAddress)']),
      args: [token],
      bytecode: bytecode('IdempotentTokenBank'),
    }),
  })
  const address = bankReceipt.contractAddress
  assert.ok(address)
  const fund = async (amount: bigint) =>
    rpc.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        account: deployer,
        address: token,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [account, amount],
      }),
    })
  await fund(parseEther('100'))
  const walletCalls: string[] = []
  const provider = {
    on: () => {},
    removeListener: () => {},
    request: ((args: { method: string; params?: unknown }) => {
      walletCalls.push(args.method)
      return args.method === 'eth_accounts'
        ? Promise.resolve([account])
        : rpc.request(args as Parameters<typeof rpc.request>[0])
    }) as EIP1193Provider['request'],
  }
  const bankClient = createBank(provider, 31337, address, account)
  let operationSequence = 0
  const bank = {
    read: bankClient.read,
    transact: (
      action: 'deposit' | 'withdraw',
      amount: string,
      progress: (message: string) => void,
    ) =>
      bankClient.transact(action, amount, progress, {
        id: numberToHex(++operationSequence, { size: 32 }),
        authorization: usePermit ? 'permit' : 'approve',
        onBroadcast: () => {},
      }),
  }
  await bank.transact('deposit', '10.000000000000000001', () => {})
  await bank.transact('withdraw', '4', () => {})
  const state = await bank.read()
  assert.equal(state.walletBalance, parseEther('93.999999999999999999'))
  assert.equal(state.deposited, parseEther('6.000000000000000001'))
  assert.equal(state.bankAssets, state.deposited)
  await admin.query(`CREATE SCHEMA ${schema}`)
  schemaCreated = true
  assert.equal(
    (await db.query<{ name: string }>('SELECT current_schema() AS name'))
      .rows[0].name,
    schema,
  )
  await initDatabase(db)
  const config = {
    chainId: 31337,
    tokenAddress: token,
    startBlock: tokenReceipt.blockNumber,
    confirmations: 0n,
    batchSize: 2n,
  }
  await scanOnce(db, rpc, config)
  server = createApp(
    db,
    config,
    { symbol: usePermit ? 'JUL' : 'BERC20', decimals: 18 },
    createOperationsRouter(db, rpc, {
      chainId: 31337,
      bankAddress: address,
      publicOrigin: 'http://localhost:3189',
      confirmations: 0n,
    }),
  ).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const httpAddress = server.address()
  assert.ok(httpAddress && typeof httpAddress !== 'string')
  const base = `http://127.0.0.1:${httpAddress.port}`
  const expected = { chainId: 31337, token, account, decimals: 18 }
  const records = await loadTransfers(`${base}/transfers`, expected)
  assert.deepEqual(
    records.transfers.map((row) => row.valueRaw),
    ['4000000000000000000', '10000000000000000001', '100000000000000000000'],
  )
  assert.equal(records.transfers[0].fromAddress, address.toLowerCase())
  assert.equal(records.transfers[1].toAddress, address.toLowerCase())
  process.env.INDEXER_URL = base
  const proxied = await GET(
    new Request(
      `http://localhost/api/transfers?address=${account}&limit=10&offset=0`,
    ),
  )
  assert.equal(proxied.status, 200)
  const proxyResult: TransferResponse = await proxied.json()
  assert.deepEqual(
    proxyResult.transfers.map((row) => row.valueRaw),
    records.transfers.map((row) => row.valueRaw),
  )
  // 重新初始化与续扫不能清空数据，也不能重复记账。
  await initDatabase(db)
  await scanOnce(db, rpc, config)
  assert.deepEqual(await loadTransfers(`${base}/transfers`, expected), records)
  for (let i = 0; i < 8; i++) await fund(1n)
  await scanOnce(db, rpc, config)
  assert.equal(
    (await loadTransfers(`${base}/transfers`, expected)).transfers.length,
    10,
  )
  assert.equal(
    (await loadTransfers(`${base}/transfers`, expected, 10)).transfers.length,
    1,
  )
  assert.equal(
    (await loadTransfers(`${base}/transfers`, { ...expected, account: other }))
      .transfers.length,
    0,
  )
  const { rows } = await db.query<{ total: number; value: string }>(
    'SELECT COUNT(*)::int AS total, SUM(value_raw)::text AS value FROM transfers WHERE from_address = $1 AND to_address = $2',
    [account.toLowerCase(), address.toLowerCase()],
  )
  assert.deepEqual(rows, [{ total: 1, value: '10000000000000000001' }])
  // 真正签名登录，身份来自会话；并发 HTTP 重放只创建一条持久记录。
  const origin = 'http://localhost:3189'
  let cookie = ''
  const call = (path: string, body?: unknown, key?: string) =>
    fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin,
        cookie,
        'content-type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  assert.equal((await call('/operations')).status, 401)
  const challenge = await (
    await call('/auth/challenge', { address: account })
  ).json()
  const message = createSiweMessage({
    address: account,
    chainId: 31337,
    domain: 'localhost:3189',
    uri: origin,
    nonce: challenge.nonce,
    version: '1',
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + 240_000),
  })
  const signature = await wallet.signMessage({ account, message })
  const signedIn = await call('/auth/verify', { message, signature })
  assert.equal(signedIn.status, 200)
  cookie = signedIn.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.ok(cookie)
  assert.equal((await call('/auth/verify', { message, signature })).status, 401)
  assert.equal(
    (await (await call('/auth/session')).json()).address,
    account.toLowerCase(),
  )
  const operationId = numberToHex(999, { size: 32 })
  const input = {
    chainId: 31337,
    bankAddress: address,
    action: 'deposit',
    amountRaw: parseEther('1').toString(),
    account: other,
  }
  const duplicates = await Promise.all(
    Array.from({ length: 20 }, () =>
      call('/operations', input, operationId).then(async (response) => {
        assert.equal(response.status, 200)
        return response.json()
      }),
    ),
  )
  assert.ok(
    duplicates.every(
      (row) =>
        row.account === account.toLowerCase() &&
        row.operationId === operationId,
    ),
  )
  assert.equal(
    (
      await db.query('SELECT * FROM operations WHERE operation_id=$1', [
        operationId,
      ])
    ).rowCount,
    1,
  )
  assert.equal(
    (await call('/operations', { ...input, amountRaw: '2' }, operationId))
      .status,
    409,
  )
  assert.equal(
    (
      await call(
        '/operations',
        { ...input, action: ['deposit'] },
        numberToHex(998, { size: 32 }),
      )
    ).status,
    400,
  )
  const testRpc = createTestClient({ mode: 'anvil', transport, chain: foundry })
  const snapshotId = await testRpc.snapshot()
  const beforeIdempotent = await bank.read()
  const transactionHash = await bankClient.transact('deposit', '1', () => {}, {
    id: operationId,
    authorization: usePermit ? 'permit' : 'approve',
    onBroadcast: () => {},
  })
  assert.ok(transactionHash)
  // 响应和哈希都丢失时，服务端仍可凭操作编号与事件确认。
  const firstResult = await (await call(`/operations/${operationId}`)).json()
  assert.equal(firstResult.status, 'confirmed')
  assert.equal(firstResult.transactionHash, transactionHash)
  assert.equal(
    (
      await db.query(
        'SELECT verified_status FROM operations WHERE operation_id=$1',
        [operationId],
      )
    ).rows[0].verified_status,
    'confirmed',
  )
  const registered = await Promise.all(
    Array.from({ length: 20 }, () =>
      call(`/operations/${operationId}/transactions`, { transactionHash }),
    ),
  )
  assert.ok(registered.every((response) => response.status === 200))
  assert.equal(
    (
      await db.query(
        'SELECT * FROM operation_transactions WHERE operation_id=$1',
        [operationId],
      )
    ).rowCount,
    1,
  )
  const replayHash = await wallet.writeContract({
    account,
    address,
    abi: parseAbi(['function deposit(uint256,bytes32)']),
    functionName: 'deposit',
    args: [parseEther('1'), operationId],
  })
  const replayReceipt = await rpc.waitForTransactionReceipt({
    hash: replayHash,
  })
  assert.equal(
    replayReceipt.logs.filter(
      (log) => log.address.toLowerCase() === address.toLowerCase(),
    ).length,
    0,
  )
  assert.equal(
    (await bank.read()).deposited,
    beforeIdempotent.deposited + parseEther('1'),
  )
  await testRpc.revert({ id: snapshotId })
  assert.equal(
    (await (await call(`/operations/${operationId}`)).json()).status,
    'pending',
  )
  assert.equal((await bank.read()).deposited, beforeIdempotent.deposited)
  // 无关哈希不能伪造成功；同样也不能改写操作归属。
  assert.equal(
    (
      await call(`/operations/${operationId}/transactions`, {
        transactionHash: replayHash,
      })
    ).status,
    200,
  )
  assert.equal(
    (await (await call(`/operations/${operationId}`)).json()).status,
    'pending',
  )
  assert.equal(
    (await call(`/operations/${numberToHex(1, { size: 32 })}`)).status,
    404,
  )
  assert.equal(
    (
      await db.query(
        'SELECT verified_status FROM operations WHERE operation_id=$1',
        [operationId],
      )
    ).rows[0].verified_status,
    'pending',
  )
  if (usePermit) {
    const expiredId = numberToHex(700, { size: 32 })
    assert.equal(
      (await call('/operations', { ...input, amountRaw: '1' }, expiredId))
        .status,
      200,
    )
    const expiredHash = await wallet.writeContract({
      account,
      address,
      abi: operationAbi,
      functionName: 'permitDeposit',
      args: [1n, expiredId, 0n, 27, zeroHash, zeroHash],
      gas: 200_000n,
    })
    assert.equal(
      (await rpc.waitForTransactionReceipt({ hash: expiredHash })).status,
      'reverted',
    )
    await call(`/operations/${expiredId}/transactions`, {
      transactionHash: expiredHash,
    })
    assert.equal(
      (await (await call(`/operations/${expiredId}`)).json()).status,
      'failed',
    )
    console.log(
      'Permit：索引、数据库、同源代理、认证、幂等恢复及过期签名回滚核实通过',
    )
  }
  const foreign = await fetch(`${base}/operations`, {
    method: 'POST',
    headers: {
      origin: 'http://evil.invalid',
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
  assert.equal(foreign.status, 403)

  // 执行页面实际使用的编排：只补 Node 缺少的 origin/cookie，所有请求走真实代理和后端。
  const nativeFetch = globalThis.fetch
  const previousLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    'location',
  )
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(origin),
  })
  t.after(() => {
    if (previousLocation)
      Object.defineProperty(globalThis, 'location', previousLocation)
    else Reflect.deleteProperty(globalThis, 'location')
  })
  let browserCookie = ''
  t.mock.method(
    globalThis,
    'fetch',
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (typeof input !== 'string' || !input.startsWith('/api/'))
        return nativeFetch(input, init)
      const headers = new Headers(init?.headers)
      headers.set('origin', origin)
      headers.set('cookie', browserCookie)
      const request = new Request(new URL(input, origin), { ...init, headers })
      const result = await (input.startsWith('/api/backend/')
        ? forwardOperation(request)
        : GET(request))
      for (const value of result.headers.getSetCookie())
        browserCookie = value.split(';')[0]
      return result
    },
  )
  walletCalls.length = 0
  const amount = '2.000000000000000001'
  const initial = await bank.read()
  let saved: Intent = {
    operationId: numberToHex(800, { size: 32 }),
    account: account.toLowerCase() as Hex,
    chainId: 31337,
    bankAddress: address.toLowerCase() as Hex,
    action: 'deposit',
    authorization: usePermit ? 'permit' : 'approve',
    amount,
    amountRaw: parseEther(amount).toString(),
    phase: 'prepared',
  }
  const options = {
    provider,
    signal: new AbortController().signal,
    isCurrent: () => true,
    persist: (intent: Intent) => {
      saved = intent
    },
    progress: () => {},
    send: true,
  }
  const deposited = await executeIntent(saved, options)
  assert.equal(saved.phase, 'confirmed')
  assert.ok(deposited.businessHash)
  assert.ok(browserCookie, '页面流程必须完成真实 SIWE 登录')
  assert.equal(
    walletCalls.filter((method) => method === 'personal_sign').length,
    1,
  )
  assert.equal(
    walletCalls.filter((method) => method === 'eth_sendTransaction').length,
    usePermit ? 1 : 2,
  )
  const afterDeposit = await bank.read()
  assert.equal(afterDeposit.deposited, initial.deposited + parseEther(amount))
  assert.equal(
    afterDeposit.walletBalance,
    initial.walletBalance - parseEther(amount),
  )
  await executeIntent(
    { ...deposited, phase: 'unknown', businessHash: undefined },
    options,
  )
  assert.equal(
    saved.businessHash,
    deposited.businessHash,
    '丢失哈希后按原编号找回交易',
  )
  assert.equal(
    walletCalls.filter((method) => method === 'eth_sendTransaction').length,
    usePermit ? 1 : 2,
  )
  const withdrawn = await executeIntent(
    {
      ...deposited,
      operationId: numberToHex(801, { size: 32 }),
      action: 'withdraw',
      authorization: 'approve',
      phase: 'prepared',
      approvalHash: undefined,
      businessHash: undefined,
    },
    options,
  )
  assert.equal(withdrawn.phase, 'confirmed')
  assert.deepEqual(await bank.read(), initial)
  await scanOnce(db, rpc, config)
  const finalRecords = await loadTransfers('/api/transfers', expected)
  assert.deepEqual(
    finalRecords.transfers.slice(0, 2).map((row) => row.transactionHash),
    [withdrawn.businessHash, deposited.businessHash],
  )
  console.log(
    '页面业务流程：SIWE → 登记 → 签名/授权 → 存款 → 原编号恢复 → 提款 → 索引 → 同源查询',
    {
      amountRaw: saved.amountRaw,
      walletBefore: initial.walletBalance.toString(),
      walletAfterDeposit: afterDeposit.walletBalance.toString(),
      bankAfterDeposit: afterDeposit.deposited.toString(),
      depositHash: deposited.businessHash,
      withdrawHash: withdrawn.businessHash,
      restoredWallet: (await bank.read()).walletBalance.toString(),
    },
  )
})

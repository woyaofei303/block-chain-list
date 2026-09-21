import { createHash, randomBytes } from 'node:crypto'
import { json, Router } from 'express'
import type { Pool } from 'pg'
import {
  type Address,
  type Hash,
  isAddress,
  isHex,
  maxUint256,
  type PublicClient,
  zeroAddress,
  zeroHash,
} from 'viem'
import { generateSiweNonce, parseSiweMessage } from 'viem/siwe'
import { inspectOperation } from './chain.ts'
import {
  addChallenge,
  createOperation,
  establishSession,
  getChallenge,
  getOperation,
  OperationError,
  type OperationInput,
  recordResult,
  recordTransaction,
  sessionAccount,
  transactionHints,
} from './repository.ts'

export type OperationConfig = {
  chainId: number
  bankAddress: Address
  publicOrigin: string
  confirmations: bigint
}
const cookieName = 'tokenbank_session'
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
const hash = (value: unknown): value is Hash =>
  typeof value === 'string' &&
  /^0x[0-9a-f]{64}$/i.test(value) &&
  value !== zeroHash
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OperationError(400, 'INVALID_INPUT', '请求内容无效')
  return value as Record<string, unknown>
}
export function createOperationsRouter(
  db: Pool,
  rpc: PublicClient,
  config: OperationConfig,
) {
  const router = Router()
  const origin = new URL(config.publicOrigin)
  router.use(
    (req, res, next) => {
      if (!/^\/(auth|operations)(\/|$)/.test(req.path)) return next('router')
      res.set('Cache-Control', 'no-store')
      if (
        req.method !== 'GET' &&
        (req.get('origin') !== origin.origin || !req.is('application/json'))
      )
        throw new OperationError(403, 'INVALID_ORIGIN', '请求来源无效')
      next()
    },
    json({ limit: '8kb' }),
  )
  router.post('/auth/challenge', async (req, res) => {
    const { address } = object(req.body)
    if (
      typeof address !== 'string' ||
      !isAddress(address) ||
      address === zeroAddress
    )
      throw new OperationError(400, 'INVALID_ADDRESS', '钱包地址无效')
    const nonce = generateSiweNonce()
    await addChallenge(db, nonce, address)
    res.json({
      nonce,
      domain: origin.host,
      uri: origin.origin,
      chainId: config.chainId,
    })
  })
  router.post('/auth/verify', async (req, res) => {
    const { message, signature } = object(req.body)
    if (
      typeof message !== 'string' ||
      message.length > 4096 ||
      typeof signature !== 'string' ||
      !isHex(signature)
    )
      throw new OperationError(400, 'INVALID_SIGNATURE', '签名内容无效')
    const parsed = parseSiweMessage(message)
    const challenge = await getChallenge(db, parsed.nonce)
    if (
      !challenge ||
      parsed.address?.toLowerCase() !== challenge.address ||
      parsed.chainId !== config.chainId ||
      parsed.uri !== origin.origin ||
      !parsed.issuedAt ||
      parsed.issuedAt.getTime() > Date.now() + 60_000 ||
      !parsed.expirationTime ||
      parsed.expirationTime > challenge.expires_at ||
      !(await rpc.verifySiweMessage({
        message,
        signature,
        domain: origin.host,
        nonce: parsed.nonce,
      }))
    )
      throw new OperationError(
        401,
        'AUTH_FAILED',
        '钱包认证失效，请重新签名登录',
      )
    const session = randomBytes(32).toString('hex')
    await establishSession(db, parsed.nonce, digest(session), challenge.address)
    res.set(
      'Set-Cookie',
      `${cookieName}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${origin.protocol === 'https:' ? '; Secure' : ''}`,
    )
    res.json({ address: challenge.address, chainId: config.chainId })
  })
  router.use(async (req, res, next) => {
    const session = req
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1)
    if (!session || !/^[a-f0-9]{64}$/.test(session))
      throw new OperationError(401, 'AUTH_REQUIRED', '请先签名登录')
    res.locals.account = await sessionAccount(db, digest(session))
    next()
  })
  router.get('/auth/session', (_req, res) =>
    res.json({ address: res.locals.account, chainId: config.chainId }),
  )
  router.post('/operations', async (req, res) => {
    const body = object(req.body)
    const operationId = req.get('Idempotency-Key')
    if (
      !hash(operationId) ||
      body.chainId !== config.chainId ||
      typeof body.bankAddress !== 'string' ||
      body.bankAddress.toLowerCase() !== config.bankAddress.toLowerCase() ||
      (body.action !== 'deposit' && body.action !== 'withdraw') ||
      typeof body.amountRaw !== 'string' ||
      !/^[1-9][0-9]{0,77}$/.test(body.amountRaw) ||
      BigInt(body.amountRaw) > maxUint256
    )
      throw new OperationError(
        400,
        'INVALID_OPERATION',
        '操作参数或目标银行无效',
      )
    const input: OperationInput = {
      operationId,
      chainId: config.chainId,
      bankAddress: config.bankAddress,
      action: body.action,
      amountRaw: body.amountRaw,
    }
    const operation = await createOperation(
      db,
      res.locals.account,
      input,
      await rpc.getBlockNumber({ cacheTime: 0 }),
    )
    res.json(operation)
  })
  router.post('/operations/:id/transactions', async (req, res) => {
    const operation = await getOperation(
      db,
      res.locals.account,
      String(req.params.id),
    )
    const { transactionHash } = object(req.body)
    if (!hash(transactionHash))
      throw new OperationError(400, 'INVALID_HASH', '交易哈希无效')
    await recordTransaction(
      db,
      operation,
      transactionHash.toLowerCase() as Hash,
    )
    res.json({ recorded: true })
  })
  router.get('/operations/:id', async (req, res) => {
    const operation = await getOperation(
      db,
      res.locals.account,
      String(req.params.id),
    )
    const result = await inspectOperation(
      rpc,
      operation,
      await transactionHints(db, operation),
      config.confirmations,
    )
    await recordResult(db, operation, result)
    res.json({ ...operation, ...result })
  })
  return router
}

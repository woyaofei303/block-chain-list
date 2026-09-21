import type { Pool } from 'pg'
import { type Address, encodeAbiParameters, type Hash, keccak256 } from 'viem'

export type OperationInput = {
  operationId: Hash
  chainId: number
  bankAddress: Address
  action: 'deposit' | 'withdraw'
  amountRaw: string
}
export type Operation = OperationInput & {
  account: Address
  payloadHash: Hash
  startBlock: string
}
export class OperationError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
export function payloadHash(action: OperationInput['action'], amount: string) {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bool' }, { type: 'uint256' }],
      [action === 'deposit', BigInt(amount)],
    ),
  )
}
const columns = `account, operation_id AS "operationId", chain_id::int AS "chainId", bank_address AS "bankAddress", action, amount_raw::text AS "amountRaw", payload_hash AS "payloadHash", start_block::text AS "startBlock"`
export async function getOperation(
  db: Pick<Pool, 'query'>,
  account: Address,
  id: string,
) {
  const { rows } = await db.query<Operation>(
    `SELECT ${columns} FROM operations WHERE account=$1 AND operation_id=$2`,
    [account.toLowerCase(), id.toLowerCase()],
  )
  if (!rows[0])
    throw new OperationError(404, 'OPERATION_NOT_FOUND', '操作不存在')
  return rows[0]
}
export async function createOperation(
  db: Pool,
  account: Address,
  input: OperationInput,
  startBlock: bigint,
) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO operations (account, operation_id, chain_id, bank_address, action, amount_raw, payload_hash, start_block)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [
        account.toLowerCase(),
        input.operationId.toLowerCase(),
        input.chainId,
        input.bankAddress.toLowerCase(),
        input.action,
        input.amountRaw,
        payloadHash(input.action, input.amountRaw),
        startBlock.toString(),
      ],
    )
    const saved = await getOperation(client, account, input.operationId)
    if (
      saved.chainId !== input.chainId ||
      saved.bankAddress !== input.bankAddress.toLowerCase() ||
      saved.action !== input.action ||
      saved.amountRaw !== input.amountRaw
    )
      throw new OperationError(
        409,
        'OPERATION_CONFLICT',
        '该操作编号已用于不同的请求，请恢复原操作',
      )
    await client.query('COMMIT')
    return saved
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function addChallenge(db: Pool, nonce: string, address: string) {
  await db.query('DELETE FROM auth_challenges WHERE expires_at < now()')
  await db.query(
    "INSERT INTO auth_challenges VALUES ($1,$2,now() + interval '5 minutes')",
    [nonce, address.toLowerCase()],
  )
}
export async function getChallenge(db: Pool, nonce: string | undefined) {
  const { rows } = await db.query<{ address: Address; expires_at: Date }>(
    'SELECT address, expires_at FROM auth_challenges WHERE nonce=$1 AND expires_at > now()',
    [nonce],
  )
  return rows[0]
}
export async function establishSession(
  db: Pool,
  nonce: string | undefined,
  tokenHash: string,
  account: Address,
) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const consumed = await client.query(
      'DELETE FROM auth_challenges WHERE nonce=$1 AND expires_at > now() RETURNING nonce',
      [nonce],
    )
    if (!consumed.rowCount)
      throw new OperationError(401, 'NONCE_USED', '登录请求已使用，请重新登录')
    await client.query('DELETE FROM auth_sessions WHERE expires_at < now()')
    await client.query(
      "INSERT INTO auth_sessions VALUES ($1,$2,now() + interval '12 hours')",
      [tokenHash, account],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
export async function sessionAccount(db: Pool, tokenHash: string) {
  const { rows } = await db.query<{ address: Address }>(
    'SELECT address FROM auth_sessions WHERE token_hash=$1 AND expires_at > now()',
    [tokenHash],
  )
  if (!rows[0])
    throw new OperationError(401, 'AUTH_REQUIRED', '登录已失效，请重新登录')
  return rows[0].address
}
export async function transactionHints(
  db: Pick<Pool, 'query'>,
  operation: Operation,
) {
  const { rows } = await db.query<{ transaction_hash: Hash }>(
    'SELECT transaction_hash FROM operation_transactions WHERE account=$1 AND operation_id=$2',
    [operation.account, operation.operationId],
  )
  return rows.map((row) => row.transaction_hash)
}
export async function recordTransaction(
  db: Pool,
  operation: Operation,
  transactionHash: Hash,
) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'SELECT operation_id FROM operations WHERE account=$1 AND operation_id=$2 FOR UPDATE',
      [operation.account, operation.operationId],
    )
    const saved = await transactionHints(client, operation)
    if (!saved.includes(transactionHash)) {
      if (saved.length >= 16)
        throw new OperationError(
          409,
          'TOO_MANY_HASHES',
          '交易线索过多，请先核对现有交易',
        )
      await client.query(
        'INSERT INTO operation_transactions VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [
          operation.account,
          operation.operationId,
          transactionHash.toLowerCase(),
        ],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// 保存最近核实结果供审计；GET 仍重新核实规范链，不能把旧确认当作当前事实。
export async function recordResult(
  db: Pool,
  operation: Operation,
  result: {
    status: 'pending' | 'confirmed' | 'failed'
    transactionHash: Hash | null
  },
) {
  await db.query(
    'UPDATE operations SET verified_status=$3, verified_transaction_hash=$4, verified_at=now() WHERE account=$1 AND operation_id=$2',
    [
      operation.account,
      operation.operationId,
      result.status,
      result.transactionHash,
    ],
  )
}

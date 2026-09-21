import { Router } from 'express'
import type { Pool } from 'pg'
import { formatUnits, isAddress } from 'viem'
import { findTransfers } from './repository.ts'
import type {
  TokenMetadata,
  TransferQuery,
  TransferResponse,
  TransferScope,
} from './types.ts'

export function createTransfersRouter(
  db: Pick<Pool, 'query'>,
  config: TransferScope,
  token: TokenMetadata,
) {
  const router = Router()
  router.all('/', async (request, response) => {
    // 包括 HEAD 在内，仅接受 GET；校验通过后才查询数据库。
    if (request.method !== 'GET') {
      return response.set('Allow', 'GET').status(405).json({ error: 'Use GET' })
    }
    const { address, limit = '50', offset = '0' } = request.query
    // 重复参数会成为数组，不能依赖隐式字符串转换。
    if (typeof address !== 'string' || !isAddress(address)) {
      return response.status(400).json({
        error: 'address must be a valid Ethereum address',
      })
    }
    if (
      typeof limit !== 'string' ||
      !/^\d+$/.test(limit) ||
      Number(limit) < 1 ||
      Number(limit) > 100 ||
      typeof offset !== 'string' ||
      !/^\d+$/.test(offset) ||
      !Number.isSafeInteger(Number(offset))
    ) {
      return response.status(400).json({
        error:
          'limit must be 1..100; offset must be a non-negative safe integer',
      })
    }
    const query: TransferQuery = {
      address: address.toLowerCase(),
      limit: Number(limit),
      offset: Number(offset),
    }
    const result = await findTransfers(db, config, query)
    response.json({
      chainId: config.chainId,
      tokenAddress: config.tokenAddress.toLowerCase(),
      ...token,
      ...query,
      indexedThrough: result.indexedThrough,
      transfers: result.transfers.map((row) => ({
        ...row,
        value: formatUnits(BigInt(row.valueRaw), token.decimals),
      })),
    } satisfies TransferResponse)
  })
  return router
}

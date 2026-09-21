import { Router } from 'express'
import { formatUnits, isAddress } from 'viem'
import { findTransfers } from '../database.mjs'

// 查询参数来自客户端，必须先校验再进入数据库查询。
// Express 会把重复的同名参数解析为数组，因此不能只依赖隐式字符串转换。
function validateTransferQuery(request, response, next) {
  const { address, limit = '50', offset = '0' } = request.query
  if (typeof address !== 'string' || !isAddress(address)) {
    return response
      .status(400)
      .json({ error: 'address must be a valid Ethereum address' })
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
      error: 'limit must be 1..100; offset must be a non-negative safe integer',
    })
  }
  // res.locals 保存本次请求通过校验的数据，后面的处理函数无需重复解析。
  response.locals.transferQuery = {
    address: address.toLowerCase(),
    limit: Number(limit),
    offset: Number(offset),
  }
  next()
}

export function createTransfersRouter(db, config, token) {
  const router = Router()
  router
    .route('/')
    .all((request, response, next) => {
      // 保持现有接口只接受 GET 的约定，包括拒绝自动映射到 GET 的 HEAD 请求。
      if (request.method !== 'GET') {
        return response
          .set('Allow', 'GET')
          .status(405)
          .json({ error: 'Use GET' })
      }
      next()
    })
    .get(validateTransferQuery, async (_request, response) => {
      const { address, limit, offset } = response.locals.transferQuery
      const result = await findTransfers(db, config, { address, limit, offset })
      // 查询只读 PostgreSQL，不触发扫块；金额以字符串返回，避免 Number 精度丢失。
      response.json({
        chainId: config.chainId,
        tokenAddress: config.tokenAddress.toLowerCase(),
        ...token,
        address,
        indexedThrough: result.indexedThrough,
        limit,
        offset,
        transfers: result.transfers.map((row) => ({
          ...row,
          value: formatUnits(BigInt(row.valueRaw), token.decimals),
        })),
      })
    })
  return router
}

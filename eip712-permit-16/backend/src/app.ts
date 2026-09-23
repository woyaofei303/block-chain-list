import express, { type ErrorRequestHandler, type Router } from 'express'
import type { Pool } from 'pg'
import { OperationError } from './operations/repository.ts'
import { createTransfersRouter } from './transfers/router.ts'
import type { TokenMetadata, TransferScope } from './transfers/types.ts'

// HTTP 入口只负责组装中间件和路由，不启动扫描、不直接查询数据库。
export function createApp(
  db: Pick<Pool, 'query'>,
  config: TransferScope,
  token: TokenMetadata,
  operations?: Router,
) {
  const app = express()
  app.disable('x-powered-by')

  // 路由按顺序执行；将来鉴权中间件放在此处、createTransfersRouter 之前。
  app.use('/transfers', createTransfersRouter(db, config, token))

  if (operations) app.use(operations)

  // 没有路由匹配时统一返回 JSON，避免 Express 默认的 HTML 404 页面。
  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' })
  })

  // Express 5 自动把 async 路由抛出的错误转给这里；必须保留四个形参。
  // 不把数据库连接信息或错误堆栈发给客户端。
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) return next(error)
    if (error instanceof OperationError) {
      response
        .status(error.status)
        .json({ code: error.code, error: error.message })
      return
    }
    if (
      error &&
      typeof error === 'object' &&
      'type' in error &&
      (error.type === 'entity.parse.failed' ||
        error.type === 'entity.too.large')
    ) {
      response
        .status(error.type === 'entity.too.large' ? 413 : 400)
        .json({ code: 'INVALID_JSON', error: '请求内容无效或过大' })
      return
    }
    response.status(500).json({ error: 'Service temporarily unavailable' })
  }
  app.use(handleError)

  return app
}

import express from 'express'
import { createTransfersRouter } from './routes/transfers.mjs'

// HTTP 入口只负责组装中间件和路由，不启动扫描、不直接查询数据库。
export function createApp(db, config, token) {
  const app = express()
  app.disable('x-powered-by')

  // 路由按顺序执行；将来鉴权中间件放在此处、createTransfersRouter 之前。
  app.use('/transfers', createTransfersRouter(db, config, token))

  // 没有路由匹配时统一返回 JSON，避免 Express 默认的 HTML 404 页面。
  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' })
  })

  // Express 5 自动把 async 路由抛出的错误转给这里；必须保留四个形参。
  // 不把数据库连接信息或错误堆栈发给客户端。
  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error)
    response.status(500).json({ error: 'Database query failed' })
  })

  return app
}

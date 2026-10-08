import { Runner } from '@chainlink/cre-sdk'
import { configSchema, initWorkflow } from './workflow'

/** 创建 CRE Runner，先用 schema 校验配置再注册 Cron 入口。 */
export async function main() {
  const runner = await Runner.newRunner({ configSchema })
  await runner.run(initWorkflow)
}

main()

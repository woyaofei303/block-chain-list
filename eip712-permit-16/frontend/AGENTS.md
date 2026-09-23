<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 请求与操作规则

先读 [项目规则](../AGENTS.md) 和 [请求与幂等说明](../REQUESTS.md)。所有新增 HTTP 请求通过 `shared/request.ts`，领域查询配置与响应校验放在对应 `domains/`。错误由 QueryCache / MutationCache 统一入队，组件保留行内状态，不直接重复弹 Toast。HTTP 并发上限 6；错误总容量 3，包含当前显示的一条。

写入禁止自动重试。存取款必须使用持久化的同一个 `operationId`，使用原操作继续不能生成新编号。终止后禁止自动刷新、重试、轮询及依赖步骤重新开始；钱包晚返回的哈希必须保存。只有用户明确继续才建立新的执行上下文。旧版银行仅可读取，不增加绕过编号的提交入口。

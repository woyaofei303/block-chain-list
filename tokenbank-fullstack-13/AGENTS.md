# Token Bank 全栈项目规则

每次工作先读 [仓库规则](../AGENTS.md) 和本文件，再读 [README](README.md) 及本次涉及的领域文档。项目编号固定为 `13`。

## 领域与边界

- `contracts/`：BaseERC20 资产和 TokenBank 存款账本，Foundry 管理源码与测试；不依赖兄弟练习的源码或测试库。
- `backend/`：Node.js / TypeScript / Express / Viem。转账领域负责扫链、检查点、重组恢复和查询接口；路由校验输入，repository 使用参数化 SQL，HTTP 层不直接编写 SQL。源码和测试均使用 `.ts`，共享领域类型位于 `src/transfers/types.ts`。
- `database/`：PostgreSQL 表结构、索引与核对 SQL；资产与个人可提余额以链上合约为准，数据库保存事件索引、登录会话和幂等操作意图；业务成功仍须核实链上证据。
- `frontend/`：Next.js / React / TypeScript / Tailwind / Wagmi / Viem；银行、钱包、转账记录按领域组织，`app/` 只负责页面、Provider 和同源 HTTP 入口。修改前读取安装版本的 `node_modules/next/dist/docs/` 对应文档。
- 本项目应独立运行。不能导入 `tokenbank-07`、`tokenbankv2-08` 或 `erc20-event-indexer-12` 的业务源码；它们保留各自历史练习。仓库共享提交钩子是开发工具，不是运行依赖。

- 模块按现有职责组织即可；没有独立职责或实际复用时，不新增 service、接口、通用仓储或自定义 Hook。单处逻辑就近实现，相同展示在原组件内复用。

## 请求、认证与幂等

- 修改请求、提示或存取款前读取 [REQUESTS.md](REQUESTS.md)。HTTP 最大并发 6；Toast 当前加等待总共最多 3，同屏一条。普通查询故障约 5 秒消失，交易结果不明等重要错误手动关闭；持续故障必须去重并等待对应请求恢复。
- `src/operations/` 负责 SIWE nonce/会话、操作记录、交易线索和链上核实；路由只做输入校验和编排，SQL 在 repository。身份只取已认证会话，不能信任客户端提交的钱包地址。
- 幂等编号贯穿 localStorage、Idempotency-Key、数据库唯一键和合约参数。参数冲突拒绝；同编号重放不能重复资金效果。新合约为 `IdempotentTokenBank`，保留旧合约源码与部署，不迁移现有余额。
- 取消是终止等待和后续步骤，不能宣称已撤回链上交易；晚返回的哈希仍保存。确认结果每次基于规范链和确认深度重新核实，不能仅凭哈希或数据库的旧状态标记成功。

## 配置与运行

- Node.js 24+；前端 pnpm，后端 npm，分别保留自己的锁文件。前端使用现有 Tailwind 和 Biome，分号 `asNeeded`。
- 前后端业务代码和测试统一使用 TypeScript；后端由 Node 原生运行 `.ts`，相对导入保留 `.ts` 扩展名，使用 `import type` 导入类型。`tsc --noEmit` 单独检查源码和测试；不使用依赖编译转换的 enum、参数属性等语法。现有环境变量与 HTTP 参数校验继续保留。
- 不覆盖已有环境配置、链状态和数据库。先区分恢复原环境与建立隔离的新环境；同一组 RPC、chain ID、Token、银行地址和索引配置必须匹配。
- 钱包资产、个人可提余额、银行总资产分别显示；金额用 bigint 和代币精度，授权不足时仅授权本次金额。每次签名前再次核对账户及网络，拒签和超时不能显示成功。
- `NEXT_PUBLIC_` 只保存公开配置；数据库连接和 `INDEXER_URL` 留在服务端。禁止将私钥、密码或令牌写进文档、测试输出和 Git。
- 不在同一前端目录同时构建与运行开发/生产服务。持久链与业务数据库不得由测试重置；测试使用独立 Anvil 和随机 PostgreSQL schema，并清理自己创建的资源。

## 验证与交付

从本项目根目录执行，各命令只运行实际存在的脚本：

```bash
forge fmt --root contracts --check
forge test --root contracts
npm --prefix backend run lint
npm --prefix backend run format:check
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run test:integration
pnpm --dir frontend lint
pnpm --dir frontend format:check
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend test:integration
pnpm --dir frontend build
```

- 前后端接入仓库 `multi-chat-py-01/web/.husky/pre-commit`，不得覆盖其原有检查。
- 迁移验收必须包含：本项目合约部署、精确金额授权与存取款、真实 PostgreSQL 入库、后端查询、前端同源代理及页面余额/记录；还要检查账户切换、拒签、分页和服务故障。
- 临时数据与浏览器证据放在仓库 `output-tdd/` 对应任务目录。README 和 WALKTHROUGH 明确运行目录、恢复步骤与本次实际验证范围。
- 本地测试和模拟可以连续完成；公共链签名、广播和外部发布沿用根目录授权规则。未经明确要求不提交或推送 Git。

# 请求、错误提示与幂等存取款

本次实现沿用 TypeScript、TanStack Query v5、Viem、Express 和 PostgreSQL，仅新增 `p-queue` 与 Sonner。先读 [AGENTS.md](AGENTS.md)，运行流程见 [WALKTHROUGH.md](WALKTHROUGH.md)。

## 1. 阅读与调用顺序

建议按一次页面操作的顺序阅读；源码中的中文注释标明状态归属、跨模块入口和不能合并的阶段。

1. [app/page.tsx](frontend/app/page.tsx) → [bank-dashboard.tsx](frontend/features/bank-dashboard.tsx) → [bank-workspace.tsx](frontend/features/bank-workspace.tsx)：页面组合、会话切换、查询、同步提交锁与终止入口。[providers.tsx](frontend/app/providers.tsx) 为页面提供稳定的 QueryClient 和全局 Toast。
2. [bank/client.ts](frontend/domains/bank/client.ts) 的 `read` / `parseAmount`：从合约读取三种余额和精度，再校验用户输入。金额、余额、设置和操作提示组件只接收属性与回调；设置弹窗另有自己的草稿。
3. 工作区 `submit` → [operations/client.ts](frontend/domains/operations/client.ts) 的 `executeIntent`：先保存意图，再登录、创建/复用操作、核实结果。需要继续链上执行时调用 `bank/client.ts` 的 `transact`，随后登记哈希并再次核实。
4. [request.ts](frontend/shared/request.ts) → [同源操作路由](frontend/app/api/backend/[...path]/route.ts) → [proxy.ts](frontend/shared/proxy.ts) → [后端 router.ts](backend/src/operations/router.ts)：HTTP 排队、超时和取消贯穿请求；代理转交会话与幂等键，后端验证身份和输入。[repository.ts](backend/src/operations/repository.ts) 管理数据库唯一约束与事务。
5. 钱包调用 [IdempotentTokenBank.sol](contracts/src/IdempotentTokenBank.sol)；后端 [chain.ts](backend/src/operations/chain.ts) 核实操作标记、事件和规范回执。同账户、同操作编号最多一次资金效果；前端不能仅凭哈希登记成功就显示业务成功。旧 `TokenBank.sol` 与历史部署保留，不能原地升级。
6. 工作区 `onSuccess` 清除本笔已确认的恢复记录、清空金额并恢复表单，保留金额与交易哈希的成功提示，同时刷新余额和记录；[transfer-history.tsx](frontend/domains/transfers/transfer-history.tsx) → [queries.ts](frontend/domains/transfers/queries.ts) → [transfers/client.ts](frontend/domains/transfers/client.ts) 查询索引结果并校验身份。键包含网络、Token、账户、精度、分页；历史记录可能晚于链上余额更新。
7. 查询或提交的最终失败 → [query-client.ts](frontend/shared/query-client.ts) → [error-queue.ts](frontend/shared/error-queue.ts) → [error-toaster.tsx](frontend/shared/error-toaster.tsx)：缓存层报告错误，队列合并、排序、抑制，Sonner 显示一条。组件保留行内错误，不重复弹提示。

阅读恢复逻辑时，重点对照工作区的 `run` / `stop` 与 `executeIntent` 的 `send` / `check` / `save`：`send=false` 只核实业务结果，必要时仍需登录、创建/复用记录或登记已知哈希；`send=true` 才允许继续授权和存取款步骤。两者复用原编号。`check` 阻止终止后的下一步，`save` 保留晚返回的哈希；浏览器终止不能撤销已经提交的链上交易。

没有新增通用 useRequest、订单框架、队列服务或跨项目依赖。当前业务只有 TokenBank，HTTP 下单场景应复用“业务写入与幂等结果同事务提交”的模式；不要把链上确认误当作可与 PostgreSQL 原子提交的本地写入。

## 2. HTTP 并发与取消

每个标签页一个 PQueue，接入 request 的 HTTP 同时最多 6 个。名额覆盖 fetch 和完整响应读取；每次重试重新排队。只在实际发送时启动 10 秒超时，排队与重试退避不占用超时预算。网络故障、超时、5xx、429 的查询最多重试一次，写入不自动重试。

钱包扩展管理自己的 RPC 与签名窗口，应用无法限制扩展内部传输；钱包签名不进入 HTTP 队列。应用取消信号会阻止后续钱包 RPC 和依赖步骤，但不能关闭扩展已经打开的签名窗口。首版只限制应用标签页内接入 request 的 HTTP，不限制其他标签页或后端集群。

多个接口可共享一个批次的信号，部分成功不丢失：

```ts
const controller = new AbortController()
const results = await Promise.allSettled(
  accounts.map((account) =>
    loadTransfers("/api/transfers", { chainId, token, account, decimals }, 0, controller.signal)
  )
)
// 用户终止时调用 controller.abort()，不要清空共享队列。
```

普通查询由 queryFn 消费 TanStack Query 的 signal。页面“终止请求”还会禁用本工作区查询，阻止重新聚焦、重新联网和 15 秒轮询重新发起；其他工作区/批次的排队任务不受影响。批量终止的 Promise 会以拒绝结束，可以由 allSettled 收集。

已提交到数据库或广播到链上的业务不会被 AbortController 撤销。每个后续异步步骤检查终止状态；钱包晚返回交易哈希时仅保存，停止后续登记、查询和存款。只有点击“核实结果”“使用原操作继续”或“恢复查询”才重新开始。

## 3. 最多三条错误提示

- 容量 3 包含当前显示与等待项；同屏只有 1 条。
- 相同业务码与规范化文案合并计数，忽略请求编号。重复不会改变首次排序，也不会延长原先的 5 秒期限。
- 当前提示不被抢占。等待项按严重等级降序、首次到达顺序排列；满额时，更严重的新错误替换最低等级中最后到达的等待项，同级保留先到者。
- 普通查询错误约 5 秒自动消失；认证失效、写入失败、结果待核实需手动关闭。关闭只推进一次，不清除操作记录。
- 关闭、丢弃或替换后的同类后台故障不反复弹出。对应请求恢复后可以再次提示；无关请求成功不能重置。用户主动新操作允许重新提示。
- 主动取消和钱包拒签不进入 Toast 队列，页面仍说明状态。

队列自身维护截止时间，Sonner 使用无限 duration 和关闭回调展示；这样更新次数不会触发 Sonner 重新计时。

## 4. 操作编号、登录与 API

首次提交生成随机非零 `bytes32 operationId`，在钱包请求前保存至 localStorage。作用域是网络、银行和账户；保存金额（展示文本和精确最小单位）、授权哈希、业务哈希、阶段。刷新或拒签后只恢复该操作，点击“使用原操作继续”仍用原编号。本次后端核实成功后，自动清除这笔恢复记录、清空金额并显示存入/取出成功，无需点击“新的一笔”；用户再次输入并提交时才生成新编号。输入或切换存取款会收起上一笔的成功提示。待核实、失败、终止或损坏的记录仍保留，不能为解锁表单而丢弃；旧版本留下的已确认记录也先核实，再自动收起。

首次提交需要一次 SIWE 登录签名，不扣款、不进行代币授权。服务端验证一次性 nonce、签名钱包、域名、URI、链、签发时间和有效期，事务内消费 nonce，创建 12 小时 HttpOnly / SameSite=Strict 会话。HTTPS 环境设置 Secure；写接口同时检查 Origin 和 JSON 类型。签名、Cookie 和数据库凭据不得写入日志。

```text
POST /auth/challenge                 { address }
POST /auth/verify                    { message, signature }
GET  /auth/session
POST /operations                    Idempotency-Key: 0x…（64 个十六进制字符）
GET  /operations/:operationId
POST /operations/:operationId/transactions   { transactionHash }
```

前端通过同源 `/api/backend/...` 访问这些接口，浏览器自动携带会话。创建操作的请求体示例：

```json
{
  "chainId": 31337,
  "bankAddress": "0x填写本轮幂等银行地址",
  "action": "deposit",
  "amountRaw": "1000000000000000000"
}
```

身份只取会话。`operations` 使用 `(account, operation_id)` 唯一键；同参数返回同一条记录，金额、动作、网络或银行冲突返回 409。数据库保存规范化参数、摘要、起始区块和最近核实的状态/哈希/时间；服务重启后仍可恢复。`operation_transactions` 对同一操作和哈希去重，每操作最多 16 条线索，行锁防止并发突破上限。

创建/登记成功不代表链上成功。保存的核实结果只作历史记录，GET 每次重新读取确认深度内的 operationHash 和 OperationExecuted 事件，核对账户、银行、动作与精确金额，查询前后检查规范区块。已知回滚还需核对交易输入和规范回执；未知/未打包/重组中的线索保持 pending。链已完成但客户端丢失哈希时，仍可由操作编号找到原始事件。

## 5. 合约与恢复边界

```solidity
function deposit(uint256 amount, bytes32 operationId) external;
function withdraw(uint256 amount, bytes32 operationId) external;
function operationHash(address user, bytes32 operationId) external view returns (bytes32);
```

摘要是 `keccak256(abi.encode(isDeposit, amount))`。同账户、同编号、同参数重放直接返回，不再次转币或产生业务事件；不同参数回滚。标记先于外部转币写入，资金转移失败时整笔交易回滚，原编号可重试；重入保护覆盖两个入口。新合约没有不带编号的入口。只适用于本项目标准 BaseERC20，不额外支持扣税、重基准等特殊代币。

授权、业务交易和索引更新分开。授权成功不会显示存款成功。已知业务哈希仍待打包时继续等待原交易，避免自动发出替代交易；等待超时保留待核实。替换、取消、掉入孤块等复杂钱包状态需要再次核实原操作与钱包记录，页面不会自动加价替换或创建另一笔业务。

首版事件证据按 2000 块分段扫描，只适合学习规模。长历史应把 OperationExecuted 接入现有索引器并保留重组检查。幂等编号不自动过期；认证 nonce/会话过期清理不删除业务操作。清空浏览器存储会失去本地恢复入口，后端仍保留操作记录，不能因此认定交易未发生。

## 6. 配置与运行

新环境完整步骤见 WALKTHROUGH 第 1～7 节，部署目标已经改为 IdempotentTokenBank。后端新增配置：

```dotenv
BANK_ADDRESS=本轮部署的幂等银行地址
PUBLIC_ORIGIN=http://127.0.0.1:3181
```

PUBLIC_ORIGIN 必须和实际浏览器地址完全相同；`localhost` 与 `127.0.0.1` 不等价。启动时验证 RPC 网络、银行 token() 和幂等查询接口。BANK_ADDRESS 留空时仍是原只读索引服务，新提交接口不可用。前端 NEXT_PUBLIC_BANK_ADDRESS 和后端 BANK_ADDRESS 必须一致。

本次没有迁移 `18545 / 13001 / 3180` 旧环境中的余额或数据。新版本源码要在独立环境部署/构建；已有前端进程使用旧构建，不能以运行中的旧页面代表新功能。不要一边运行同目录服务一边构建。

## 7. 验证

从项目根目录运行 AGENTS.md 中的检查命令。测试使用随机 PostgreSQL schema 与独立 Anvil，自动清理，仅使用本地解锁测试账户，不读取私钥。

- Node 单元测试：6 个 HTTP 名额、等待任务零发送、在途取消、超时预算、缓存复用、取消重试、重试一次；队列合并、上限、优先级、幂等关闭、故障恢复；本地操作恢复和作用域隔离。
- PostgreSQL 与 HTTP：并发重放只产生一条操作、409 冲突、重启恢复、SIWE 真实签名、nonce 重放拒绝、会话身份、Origin 拒绝、交易登记去重。
- Forge：相同编号资金效果一次、动作/金额冲突、失败回滚可重试、没有旧入口、重入拒绝及提款转币失败恢复账本。
- 本地集成：精确金额存取款、拒签、账户切换、授权后终止并保存晚返回哈希；丢失哈希仍可核实，规范链回滚后不保持已确认。

浏览器证据与本轮检查记录保存在仓库 `output-tdd/playwright/tokenbank-request-management/` 和 `output-tdd/tokenbank-request-management/`。这些是本地运行产物，不纳入提交。

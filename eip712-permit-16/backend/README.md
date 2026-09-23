# Token Bank 转账后端

新增请求与幂等闭环请先读 [REQUESTS.md](../REQUESTS.md)，其中说明新版银行、SIWE 会话、操作表、取消和恢复边界。

从本项目合约读取 ERC20 `Transfer`，按确认区块分批保存到 PostgreSQL，向前端提供 `GET /transfers`。它不管理钱包、不签名，也不代替银行合约判断可提余额。

先读 [项目规则](../AGENTS.md) 和 [完整操作流程](../WALKTHROUGH.md)。代码来自原转账索引练习，在本项目独立维护；无需启动兄弟项目。

源码与测试统一使用 TypeScript。Node.js 原生运行 `.ts`，无需构建或额外运行器；`tsc --noEmit` 负责严格类型检查。使用普通 TypeScript 类型和现有输入校验，不额外引入 Zod。

## 配置与启动

以下在 `backend/` 执行，需要 Node.js 24+ 和 PostgreSQL：

```bash
npm ci
test -f .env || cp .env.example .env
```

按实际部署填写 `.env`：

- `RPC_URL`、`CHAIN_ID`：目标节点与链 ID。默认本地 `8547` / `31337`。
- `TOKEN_ADDRESS`：必须填写本项目实际 Token 地址，不能填银行地址、零地址或沿用其他练习的默认代币。
- `START_BLOCK`：Token 部署区块；恢复索引时保持与原配置一致。
- `PGHOST`、`PGPORT`、`PGDATABASE`：本机 PostgreSQL。程序默认数据库名 `tokenbank_permit_16`，数据库须事先存在。
- `CONFIRMATIONS`：默认 `12`；本地按交易出块的 Anvil 可显式设为 `0`。
- `BATCH_SIZE`、`POLL_INTERVAL_MS`：默认 `2000` 块和 `12000` 毫秒。
- `BANK_ADDRESS`：本轮幂等银行地址，启用操作写接口；须与前端一致。
- `PUBLIC_ORIGIN`：实际浏览器来源，默认 `http://127.0.0.1:3016`；登录及写请求检查来源。
- `HOST`、`PORT`：默认仅监听 `127.0.0.1:13016`。

```bash
npm start
```

只追到本轮确认高度后退出：

```bash
npm run scan
```

程序校验网络、读取代币精度，加载 [数据库结构](../database/schema.sql)，保留已有记录和进度。更换链、代币或从零重建本地链时使用独立数据库；不要清空仍用于复习的历史数据。

## 查询与边界

```bash
curl --fail --silent --show-error \
  'http://127.0.0.1:13016/transfers?address=0x填写钱包地址&limit=10&offset=0'
```

`address` 必填，查询收支，自转账只计一次。`limit` 为 1～100，`offset` 为非负安全整数；重复参数拒绝。结果包含 chainId、tokenAddress、symbol、decimals、address、indexedThrough 和 transfers；区块及金额用字符串传输，金额不经过浮点数。

`indexedThrough=null` 表示尚未完成首批扫描，包括正在等待确认区块；有检查点后才返回已扫描区块号。

参数错误返回 400，未知路径 404，非 GET 405，数据库查询失败 500。空结果返回 200，但要结合 indexedThrough 判断是否已扫描到目标交易。链上回执成功与索引可见是两个阶段。

一批事件与进度同事务提交；失败回滚后从原进度重试；主键避免重复。发现检查点哈希变化时，仅重建该链该代币的索引。该全量重扫策略适合练习规模。

按以下顺序阅读，浏览器经 Next.js 同源代理访问，不连接数据库：

1. `src/main.ts`、`src/config.ts`：进程生命周期、配置类型与环境变量校验。
2. `src/transfers/types.ts`：扫描配置、代币信息、分页查询、数据库记录与 HTTP 响应的领域类型；金额和区块号在接口中保持字符串。
3. `src/transfers/indexer.ts`：扫描、事务与检查点；RPC 能力和扫描进度类型就近定义。
4. `src/transfers/repository.ts`：表初始化和带结果类型的参数化查询。
5. `src/app.ts`、`src/transfers/router.ts`：HTTP 组合、参数校验、响应格式和统一错误处理。

TypeScript 不能代替运行时校验：环境变量、地址、分页和 RPC 网络核对仍在执行时检查。模块之间只共享实际需要的类型，不额外增加 service 或通用仓储层。

## 检查

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:integration
TEST_PERMIT=1 npm run test:integration
```

测试默认在本机 `postgres` 数据库建立随机 schema，清理范围只限本次 schema。完整集成测试还需要 Foundry 和同项目前端依赖，验证实际合约、银行客户端、索引、HTTP 和前端代理，不发送公共网络交易。

共享提交钩子对本后端依次运行暂存文件 lint/format、严格类型检查和普通测试；完整集成测试使用 `npm run test:integration` 单独执行。

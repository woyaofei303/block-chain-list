# 银行后端：核实一笔操作，查询一页历史

先按 [项目入口](../README.md) 和 [操作指南](../WALKTHROUGH.md) 准备合约。后端处理两类工作：证明“哪位用户请求了什么，并且链上是否完成”，以及把 Token 转账整理成可查询记录。它不保管私钥，不替用户签交易。

## 用一笔 10 BERC20 存款理解职责

用户登录后登记操作编号。钱包广播存款，后端收到交易哈希线索，再查银行操作标记、事件和回执；确认账户、金额、动作、银行都匹配，才报告业务成功。

与此同时，索引器扫描 Token 的 Transfer，把用户到银行的转账写进数据库。两条工作线可能不同时完成：存款已成功，不代表历史列表已经追平。本项目使用普通 approve 后存款。

## 配置与启动

需要 Node.js 24+ 和已运行的 PostgreSQL。从仓库根目录进入：

```bash
cd tokenbank-fullstack-13/backend
npm ci
test -f .env || cp .env.example .env
```

若已按操作指南准备 session 配置，直接加载它；不要再填写另一组冲突地址。手工配置时重点核对：

- `RPC_URL / CHAIN_ID / TOKEN_ADDRESS / START_BLOCK`：同一条链上的 Token 及部署起点。
- `BANK_ADDRESS`：本轮幂等银行，后端会核对 token 和幂等查询接口；留空只提供原只读索引服务。
- `PUBLIC_ORIGIN`：浏览器实际访问的协议、主机和端口，决定登录与写接口来源检查。
- `PGHOST / PGPORT / PGDATABASE` 等：已有数据库连接，数据库必须先创建。
- `HOST / PORT`：本地监听地址；与前端服务端的 INDEXER_URL 对应。
- `CONFIRMATIONS / BATCH_SIZE / POLL_INTERVAL_MS`：确认等待、每批区块数与轮询间隔。

数据库密码只在忽略的本地配置或已有认证方式中设置。启动后程序核对链与合约，再加载 [schema.sql](../database/schema.sql)，不清空原数据。

```bash
npm start
```

`npm run scan` 只做本轮扫描后退出。默认按确认高度扫描，本地按交易出块的 Anvil 在指南中设置 `CONFIRMATIONS=0`，公共链不要直接沿用。

## 查询后如何判断空结果

按指南启动后，在任意终端替换钱包地址进行只读查询；端口若已改动，URL 同步更换：

```bash
curl --fail --silent --show-error \
  'http://127.0.0.1:13002/transfers?address=0x填写完整钱包地址&limit=10&offset=0'
```

`address` 必填，`limit` 1～100，`offset` 为非负安全整数，同名参数不能重复。返回含 chainId、tokenAddress、decimals、indexedThrough 和 transfers。

空数组仍可返回 200，含义是当前索引范围没有匹配记录。先比较 `indexedThrough` 和交易区块；为 null 时尚未完成首批扫描。参数错误返回 400，未知路由 404，转账查询方法不支持为 405，数据库故障为 500。

金额与区块号用字符串返回，不能随手 Number()。一笔交易多条日志要分别保留；自转账在一次地址查询中只返回一条。

## 数据为什么能在失败后恢复

一次扫块的事件与进度放在同一数据库事务提交。若写入中断，二者一起回滚；重试再扫时通过唯一键避免重复。

检查点保存最后处理区块的哈希。发生链重组时，该项目重新建立目标链、目标 Token 的索引，适合教学规模；不要把这描述成“数据库永久保存不可变事实”。

业务操作同样有唯一键。同编号同参数返回原记录，参数冲突报 409；账户来自已认证会话，不能相信请求正文里随便写的钱包地址。详见 [REQUESTS](../REQUESTS.md)。

## 对照源码和测试

先读 [main.ts](src/main.ts) 的启动接线，再分两条路线：

1. 操作：`src/operations/router.ts → repository.ts / chain.ts`，看输入、保存和链上核实。
2. 历史：`src/transfers/indexer.ts → repository.ts → router.ts`，看扫描与查询。

TypeScript 在开发时检查类型；环境变量、HTTP 参数和 RPC 返回仍需运行时校验。SQL 使用参数化查询，错误响应不回传凭据或内部堆栈。

在 backend 目录执行：

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run test:integration
```

数据库测试使用临时随机 schema；完整集成还需本项目前端依赖与 Foundry，启动独立 Anvil 后自动清理。2026-10-09 已通过 4 项后端测试和完整本地集成，lint 与类型检查也通过；测试使用独立 schema 并在结束后清理。

# 12 · 把链上转账整理成可查询的历史

钱包要显示“我的收支明细”，每次从头扫链会很慢。本项目用 Viem 读取 ERC20 的 `Transfer` 事件，写入 PostgreSQL，再由 Express 提供查询接口。它读取已有代币，不需要重新发行。

先理解 [07 的 ERC20](../tokenbank-07/README.md)。本课关注历史查询，账户当前余额仍应以链上 Token 为准。

## 用 Alice 转 10 枚给 Bob 举例

链上转账成功后，Token 发出 `Transfer(Alice, Bob, 10枚的最小单位)`。索引器读取这条日志，保存区块、交易、发送方、接收方和金额。Alice 查地址能看到转出，Bob 查地址能看到转入。

**索引**就是把原始事件整理成便于查找的数据。一次交易可以产生多条日志，因此不能只用交易哈希去重；日志序号同样重要。自转账虽然同时满足收与支，查询只返回一次。

## 准备与启动

需要 Node.js 22.13+、npm、可连接的 PostgreSQL 和 Sepolia RPC。下面从仓库根目录执行；不要假定另一台机器已经有数据库。

```bash
cd erc20-event-indexer-12
npm ci
test -f .env || cp .env.example .env
```

只有数据库尚不存在时才运行一次：

```bash
createdb erc20_indexer
```

在本地 `.env` 配好数据库连接。可用 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD` 或 `DATABASE_URL`；不要把真实凭据放进文档。

默认教学对象是 Sepolia 的 MTK：

```text
CHAIN_ID=11155111
TOKEN_ADDRESS=0xaa0ce32d799459b6a617a0c07cfc79b4048e4dbc
START_BLOCK=11702875
```

若换代币，RPC、chain ID、地址、起始区块要一起核对。已保存的起点不能随意改；重新学习另一数据集时使用独立数据库，别清空原记录。

确认本机 3001 空闲后，在本项目目录启动：

```bash
npm start
```

它自动建表、打开 `127.0.0.1:3001` 并在后台扫描。出现 `Indexed through block ...` 表示扫描已推进，不代表永远追到最新链头。只补历史后退出可用 `npm run scan`。按 `Ctrl+C` 停止，再启动会从已保存进度继续。

## 查到一条记录之后怎么看

另开终端执行只读 HTTP 查询：

```bash
curl --fail --silent --show-error \
  'http://127.0.0.1:3001/transfers?address=0x000071424bb08b910f0786e04d964a63d64bf1ba&limit=50&offset=0'
```

`address` 必填；`limit` 默认 50、范围 1～100；`offset` 默认 0、不能负数。重复传同名参数会报 400。空数组可能表示无记录，也可能尚未扫到目标区块，要同时查看 `indexedThrough`。

`valueRaw` 是原始最小单位字符串，`value` 是按 decimals 换算的字符串。例如 18 位精度的 `10000000000000000000` 显示为 `10`。不能先转 JavaScript Number，否则大整数可能失真。

结果按区块和日志序号倒序排列。铸币从零地址转出，销毁转入零地址，也属于 Transfer；它们不是普通用户之间的转账。

## 一轮扫描怎样保证不漏、不重复

```text
main 读取并校验配置 → 核对链和 Token → 从数据库读 next_block
indexer 分批 getLogs → 插入日志 + 更新进度 → 同一个数据库事务提交
app 接收地址查询 → database 参数化查询 → 返回 JSON
```

假设从 100 扫到 109，成功后下一次从 110 开始。如果日志写到一半数据库失败，事务把日志和进度一起撤销，下次仍从 100 重试；唯一约束避免重试重复入库。

默认保留 12 个确认块、每批最多 2,000 块、每轮间隔 12 秒。确认等待降低遇到变化的概率，但不是绝对保证。若历史检查点的区块哈希变了，说明可能发生**重组**（节点认可的历史发生替换），索引器按检查点回退并重扫。

## 对照代码与验证

依次阅读 [main.mjs](src/main.mjs)、[indexer.mjs](src/indexer.mjs)、[database.mjs](src/database.mjs)，最后看 [HTTP 路由](src/routes/transfers.mjs)。先顺着一次扫描走完，再研究重组分支。

在项目目录执行：

```bash
npm test
npm run lint
npm run format:check
```

扫描集成测试需要真实 PostgreSQL，但使用独立随机 schema 并清理，保留已有业务记录；覆盖断点续扫、重复日志、金额精度、事务回滚和重组。当前项目是 JavaScript，没有额外 `typecheck` 脚本。

## 排错与学习边界

- RPC 限流：减小 `BATCH_SIZE`，检查网络；不要跳过区块伪造进度。
- HTTP 500：检查数据库服务和本地连接配置，接口不会把内部凭据返回给客户端。
- 浏览器跨域：当前没有默认放开 CORS，也没有身份鉴权；前端可用同源代理。不要直接当公网服务部署。
- 明明已转账却没记录：先核对网络和 Token，再比较交易区块与 `indexedThrough`。

历史记录：2026-09-18 扫描到 1 条铸币日志，查询显示 100 亿 MTK；当时没有普通转账。2026-10-09 已通过 3 项测试及 lint，其中数据库测试使用本地 PostgreSQL 临时 schema；未运行公共 RPC 扫描。完整钱包联调可继续读 [13](../tokenbank-fullstack-13/README.md)。

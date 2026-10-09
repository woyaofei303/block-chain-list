# 前端：输入 10 枚之后，页面怎样知道存款成功

先读 [项目 README](../README.md)，运行按 [WALKTHROUGH](../WALKTHROUGH.md)。本篇解释界面上的数据和状态，再对应到代码，不重复整套部署命令。

## 先理解账户、代币和银行

钱包账户是你的身份；Token 地址决定哪种币；银行地址决定存款账本；RPC 决定访问哪一份链状态。四者不能互换。MetaMask 添加 Token 只是显示资产，不会给你发币。

假设 Alice 钱包 100、个人银行存款 0，Bob 在同一家银行存了 20。Alice 页面看到钱包 100、个人 0、银行资产 20；不能因为银行有 20 就让 Alice 取走它。

Alice 存 10 后显示钱包 90、个人 10、银行资产 30；再取 4 后是 94、6、26。存入模式的“全部”取钱包余额，取出模式的“全部”取个人存款。

直接转 Token 给银行只增加其实际资产，不增加个人账本；合约没有认领这部分余额的入口。

## 一次点击经历了什么

```text
输入金额 → 按 decimals 转 bigint → 保存 operationId
SIWE 登录 → 后端登记或复用操作 → 核实是否已完成
必要时 approve → deposit → 保存哈希 → 后端确认
刷新余额与历史 → 显示成功并清理该笔恢复记录
```

SIWE 是钱包登录签名，不扣款；approve 是授权，不存款。必须等存款的链上效果被核实，才能显示“存入成功”。金额输入拒绝零、负数、科学计数法、超精度和超余额，不悄悄四舍五入。

钱包签名前会再次核对账户和网络，避免 Alice 填好后切到 Bob，仍按旧页面上下文继续操作。

## 刷新、拒签与终止分别怎样处理

操作编号和金额在钱包请求前保存到 localStorage。刷新后发现未完成操作，先点“核实结果”；确实需要继续时使用原编号，不能换一个编号重做。

终止会停止后续步骤和查询轮询，但不能撤回已经广播的交易，也不能强行关闭钱包弹窗。钱包晚返回的哈希仍保存；只有用户主动恢复才继续执行。详见 [请求与恢复](../REQUESTS.md)。

已核实成功的操作会收起恢复提示并清空金额。待核实、失败或损坏记录不会为了让按钮可点而直接丢弃。

## 历史列表为什么比余额慢

余额直接来自链，历史来自后端 Transfer 索引。存款是钱包转出到银行，提款是转入钱包；approve 不产生 Transfer，所以不在列表中。

浏览器请求同源 `/api/transfers`，Next.js 再转给 Express；登录与操作接口走 `/api/backend/...`。密钥和数据库连接留在服务端，不能放入 `NEXT_PUBLIC_`。

同一标签页的应用 HTTP 最多并发 6 个；钱包扩展自己的 RPC 不属于这条队列。最终错误统一进提示队列，总容量 3、同屏 1 条，避免一次故障弹满页面。

## 对照代码阅读

1. [bank-workspace.tsx](features/bank-workspace.tsx)：从 submit 跟到成功、终止和恢复。
2. [bank/client.ts](domains/bank/client.ts)：精确金额、余额读取与钱包交易。
3. [operations/client.ts](domains/operations/client.ts)：保存意图、登录、登记、核实。
4. [transfer-history.tsx](domains/transfers/transfer-history.tsx)：历史与分页。
5. [request.ts](shared/request.ts)：HTTP 排队、超时、取消。

组件之间传实际状态与回调，跨领域编排放 features；样式使用现有 Tailwind。旧不带 operationId 的银行只读，新页面不会替它开放绕过编号的入口。

## 运行与验证

先按操作指南加载同一轮配置，再从项目根目录启动：

```bash
pnpm --dir frontend dev --port 3181
```

检查在项目根目录执行：

```bash
pnpm --dir frontend lint
pnpm --dir frontend format:check
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend test:integration
```

生产预览前停止同目录 dev，再 build / start。公开环境变量会写入构建，修改后需重新 build；后端地址 INDEXER_URL 仍是服务端配置。

RPC 测试不能代替真实浏览器钱包交互。2026-10-09 已通过 11 项前端测试、本地 RPC 集成，以及 lint 和类型检查；未启动页面做钱包扩展验收，旧 3180 环境见 [历史资料](../HISTORY.md)。

# Permit 银行前端

从第 13 题复用现有 Next.js 16 / React / TypeScript / Tailwind 4 / Wagmi / Viem / TanStack Query 页面，增加 Permit 签名授权。完整安装、钱包配置、部署和联调命令统一见 [WALKTHROUGH](../WALKTHROUGH.md)，业务流程见 [总览](../README.md) 与 [请求说明](../REQUESTS.md)。

## 页面操作

1. 连接具体钱包，核对账户、chain ID 和 RPC；银行设置填写本轮 `IdempotentTokenBank` 地址。
2. 输入金额，选择“签名授权”或“普通授权”。签名授权先签署本次额度，再确认一笔存款交易；首次操作另需 SIWE 身份签名。
3. “取出”只可提取自己的银行存款。钱包余额、个人存款、银行总资产分别展示，禁止用总资产作为个人提款额度。
4. 已广播后等待超时或刷新，先“核实结果”，需要继续时沿用原 operationId；终止不等于交易被撤回。
5. 历史记录来自后端索引，可能晚于链上余额更新。服务错误和未连接状态不会伪造零余额或成功记录。

未支持 Permit 的 Token 或旧幂等银行使用普通授权；无 operationId 的历史银行只读。金额按合约 decimals 转为 bigint，拒绝零、负数、科学计数法、超精度及超额。

## 配置与源码

`.env.example` 仅含公开参数；`.env.local` 不纳入 Git。默认本地 RPC 为 `8547`，演示页面端口为 `3016`，`INDEXER_URL` 指向后端 `13016`。`NEXT_PUBLIC_` 进入浏览器，不能保存密钥。生产构建会固定公开环境变量，修改后须重新构建。

- `features/bank-dashboard.tsx` / `bank-workspace.tsx`：原页面布局及工作区。
- `domains/bank/client.ts`：余额、金额、账户/网络校验、Permit、模拟、交易与回执。
- `domains/operations/client.ts`：登录、持久化意图、幂等和恢复。
- `shared/request.ts` / `error-queue.ts`：HTTP 并发 6、取消、错误容量 3。
- `app/api/`：Next 同源代理；浏览器不直接连接数据库。
- `scripts/permit-setup.mts`：本地部署入口，stdout 为 JSON，提示写 stderr，便于命令行保存配置。

本目录使用 pnpm 与原锁文件，Husky 仍指向仓库共享钩子。请勿与同目录开发/生产服务同时运行 build。

从本项目根目录执行：

```bash
pnpm --dir frontend lint
pnpm --dir frontend format:check
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend test:integration
pnpm --dir frontend test:permit
pnpm --dir frontend build
```

普通 RPC 测试验证历史银行只读、普通授权、取消与恢复；Permit RPC 测试直接调用生产客户端，并完成 NFT 白名单购买。它们使用独立 Anvil，不要求真实钱包扩展，也不能当作人工扩展钱包验收。

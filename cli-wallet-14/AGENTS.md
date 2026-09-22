# CLI Wallet 项目规则

适用于本目录，先读[仓库规则](../AGENTS.md)。

- Node.js 24+、npm、TypeScript strict、Ethers v6；无前端、数据库或新合约部署。
- 入口：`src/cli.ts`；钱包与交易逻辑：`src/wallet.ts`；验证：`test/wallet.test.ts`。
- 从本目录执行 `npm ci`、`npm run lint`、`npm run format:check`、`npm run typecheck`、`npm test`。提交检查接入根仓库已有 Husky 钩子。
- 只支持 Sepolia（11155111）；验证优先使用离线模拟或隔离的本地 Anvil。公共链签名和广播需要具体参数授权，不能因题目要求直接发送。
- 私钥仅在内存中使用，持久化为加密 keystore；不输出私钥/助记词，不接受明文私钥环境变量。密码只通过终端隐藏输入。
- 交易默认只构建和模拟；显式 `--send`、费用上限和交互确认后才解锁、签名、广播。金额保持 bigint，精度读取合约。
- `.wallet/` 保存加密钱包和不含签名原文的交易记录，已忽略；不覆盖已有钱包。RPC 失败不得输出包含凭据的原始错误。

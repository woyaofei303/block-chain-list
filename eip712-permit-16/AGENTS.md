# EIP-712 全栈练习规则

先读 [仓库规则](../AGENTS.md)，本文件适用于本项目；编号固定为 16。

- 本目录集中维护从第 13 题复用的银行、前端、后端、数据库，以及第 08 题市场和第 11 题 NFT。业务源码、测试、启动入口只能依赖本目录，不再跨目录导入其他练习的业务代码。旧项目保留历史版本。
- `contracts/`：Solidity 0.8.24 / Cancun / Foundry，OpenZeppelin 与 forge-std 继续复用 `../../foundry-counter-09/lib`，不重复安装。生产合约与兼容回归合约在 `src/`，测试在 `test/`。
- `frontend/`：Node.js 24+、pnpm 11.21.0、Next.js 16、React、TypeScript strict、Tailwind 4、Wagmi/Viem、TanStack Query。先读该目录 AGENTS 和已安装 Next.js 对应文档。
- `backend/`：npm、TypeScript strict、Express/Viem/PostgreSQL；`database/` 是表结构唯一入口。沿用 SIWE、operationId 去重、取消恢复、索引重组校验；金额用 bigint 或精确字符串。
- 官方 Permit2 / Solmate 固定源码位于 `contracts/lib/permit2`，单独使用 Solidity 0.8.17 / London / via-IR 编译；禁止修改上游源码以迁就银行编译器。先运行 `forge build --root contracts/lib/permit2`，再运行银行 Forge 测试；新部署须传入真实 Permit2 地址，零地址仅表示禁用。
- Permit、Permit2 与普通存款共享账本、编号和事件。白名单绑定买家、卖家、tokenId、价格、nonce、deadline、链与市场；禁用继承的普通购买及回调入口。仅支持无手续费、无 rebase 的 Token；EOA 签名。
- 从本项目根目录运行 `forge fmt --root contracts --check`、`forge test --root contracts -vvv`；前端执行 `pnpm --dir frontend lint`、`format:check`、`typecheck`、`test`、`test:integration`、`test:permit`、`test:permit2`、`build`；后端执行对应 npm 检查及 `TEST_PERMIT=1 npm --prefix backend run test:integration` 及 `TEST_PERMIT2=1 npm --prefix backend run test:integration`。
- 沿用仓库共享 Husky / lint-staged / Biome 和原锁文件，禁止改写 hooksPath。完整步骤见 README 与 WALKTHROUGH；运行前检查端口，禁止同目录同时运行 Next 构建和服务。
- 演示只用本地 Anvil 解锁账户，默认 RPC 8547、后端 13016、前端 3016、chain ID 31337。公共链操作遵守根规则；不得复制其他目录的 .env、密钥、链状态或数据库。
- Permit2 新环境的 8548 / 13018 / 3018、命令行签名与交易次数说明见 [PERMIT2.md](PERMIT2.md)；本地证据放 `output-tdd/permit2/`，不覆盖原演示状态。
- 测试使用独立 Anvil 和临时 PostgreSQL schema，并清理自己的资源。演示状态与日志在仓库 `output-tdd/eip712-consolidate/`，恢复时沿用同一状态、部署地址和数据库，不重复部署或充值。

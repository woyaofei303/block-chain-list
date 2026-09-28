# esRNT 私有存储读取练习

本目录遵守 [根规则](../AGENTS.md)。本题采用 Node.js 24+、TypeScript strict、Viem、npm，以及 Solidity 0.8.24 / Foundry / Shanghai；Solidity 不安装第三方库。

- 阅读顺序：`README.md` → `src/esRNT.sol` → `src/read-locks.ts` → `test/` → `script/Deploy.s.sol`。
- `_locks` 必须保持 private 和 slot 0 的原始布局，不添加 getter；读取使用 Viem `getStorageAt`，同一次读取固定区块号，金额和时间使用 bigint。
- 部署仅通过 `forge script`。默认独立本地 Anvil，使用公开的解锁测试账户，不读取或输出私钥。读取已有网络只需 RPC 和合约地址。
- `npm run check` 执行 Biome、类型检查、Node 测试及 Forge 格式/构建/测试；`npm run read` 读取配置的合约。共享提交钩子调用本项目 `npm run precommit`，保留仓库 hooksPath。
- `test/read-locks.test.ts` 验证打包解码与失败路径；`test/esRNT.t.sol` 验证实际合约的全部 11 项。最终交付还必须对 Anvil 部署运行真实 Viem 读取并核对输出。
- 本次用户要求的可公开运行记录放在 `RUN_LOG.md`；原始 RPC、广播、缓存与临时日志保持忽略，不提交秘密或完整 RPC 凭据。Anvil 日志不代表公共测试网部署。

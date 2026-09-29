# Merkle NFT Market 练习规则

本目录遵守 [仓库规则](../AGENTS.md)，固定编号 20。

- Solidity 0.8.24 / Cancun / Foundry；只共享 `../foundry-counter-09/lib` 的 OpenZeppelin 与 forge-std，不跨项目导入业务源码。
- Node.js 24+ / TypeScript strict / npm / Viem；`src/*.ts` 提供 Merkle 树与 multicall 编码，`script/demo.ts` 运行本地购买，`test/` 保存 Forge 和 Node 测试。
- 合约名保留题面拼写 `AirdopMerkleNFTMarket`；固定 Token、NFT 与 Merkle root，非托管挂单，白名单按地址验证。五折按最小单位向上取整，不增加每地址限购。
- Permit 的 owner 必须为调用者、spender 固定为市场；multicall 复用 OpenZeppelin 的自身 delegatecall，任一步失败整体回滚。仅支持本项目无手续费、无 rebase 的 Token。
- 每个自有函数及关键逻辑写中文学习注释。运行 `npm run check`、`npm run test:integration`，部署仅通过 `forge script script/Deploy.s.sol:Deploy`。
- 演示仅允许 chain ID 31337 的本机 Anvil，使用 RPC 解锁账户签名，不读取私钥；集成测试独立启动随机端口并在结束时关闭。
- 共享 pre-commit 调用本项目 `npm run precommit`，保留现有 hooksPath；本地临时日志放 `../output-tdd/merkle-nft-market-20/`，构建及广播记录忽略。

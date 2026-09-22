# 多签钱包项目规则

适用于本目录，先遵守 [仓库规则](../AGENTS.md)。

- 技术栈：Solidity `0.8.24`、Foundry，EVM `shanghai`，关闭优化；没有 npm 包或第三方合约依赖。
- 源码入口：`src/MultiSigWallet.sol`；测试入口：`test/MultiSigWallet.t.sol`。修改前先读 [README](README.md)。
- 持有人和门槛部署后固定。提交不自动确认，同一持有人对同一提案只能确认一次；达到门槛后任何地址都可执行。
- 提案目标、ETH 金额和 calldata 提交后不可修改。外部调用前标记已执行；调用失败必须回滚，保留原确认供重试。
- 测试只使用 Forge 本地 EVM 和实际需要的 cheatcode，不读取密钥、不访问公共 RPC、不广播公共链交易。
- 编译产物与缓存存放在 `../output-tdd/multisig-wallet-15/`，不提交。

从仓库根目录验证：

```bash
forge fmt --root multisig-wallet-15 --check
forge build --root multisig-wallet-15
forge test --root multisig-wallet-15 -vv
```

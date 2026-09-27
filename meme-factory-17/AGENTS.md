# Meme 最小代理工厂规则

适用于本目录；先读取并遵守 [仓库规则](../AGENTS.md) 和 [README](README.md)。

- Solidity `0.8.24`、Foundry、EVM `shanghai`，优化器开启、200 runs；没有 Node 包或前端。
- 独立管理本项目 `lib/` 内的 OpenZeppelin `v5.7.0` 和 forge-std `v1.16.2`，来源提交记录在 README。依赖源码随本项目保存，不引用兄弟项目的库，也不创建嵌套 Git 仓库；恢复依赖使用 README 中固定版本的 `forge install --no-git` 命令。
- 源码入口：`src/MemeToken.sol`、`src/MemeFactory.sol`；行为测试：`test/MemeFactory.t.sol`。
- 工厂创建 ERC-1167 clone 后必须在同一交易初始化；实现合约禁用初始化，每个 clone 只能初始化一次，只有创建它的工厂可以铸币。
- 代币 `decimals = 0`，数量表示整数枚，`price` 表示每枚的 wei 价格；每次收费 `perMint * price`，必须精确支付。平台分成向下取整为费用的 1%，余数归发行者。
- 每次成功铸造严格为 `perMint`，不足一批时整笔拒绝。分账失败必须回滚铸币与全部资金变动，外部收款回调不得重入铸造。
- 默认只使用 Forge 本地 EVM 或独立 Anvil，不读取私钥、不访问公共 RPC、不广播公共链交易。
- 缓存、编译产物与完整测试日志放在 `../output-tdd/meme-factory-17/`；README 保留实际测试摘要。

从仓库根目录验证：

```bash
forge fmt --root meme-factory-17 --check
forge build --root meme-factory-17
forge test --root meme-factory-17 -vv
```

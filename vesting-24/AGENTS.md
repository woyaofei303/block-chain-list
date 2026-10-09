# Vesting 项目规则

本目录遵守[仓库规则](../AGENTS.md)。这是一个 Solidity / Foundry 线性解锁练习，只在本地 Forge EVM 和本地 Anvil 验证，不部署公共链、不使用真实资金。

- 使用 Solidity `0.8.24`、Foundry；独立依赖放在本项目 `lib/`，固定 forge-std `1.16.2` 与 OpenZeppelin `5.7.0`，保留许可证。不得改回兄弟项目引用或隐式升级版本。
- 代码入口为 `src/LinearVesting.sol` 和 `src/VestingToken.sol`，行为测试为 `test/LinearVesting.t.sol`，部署入口为 `script/DeployVesting.s.sol`。
- 时间按 Solidity `30 days` 近似一个教学月：先经过 12 个月 Cliff，之后每完整经过一个月按 24 个月线性比例释放；最终释放不晚于 Cliff 后 24 个月。
- 修改自有 Solidity、测试或脚本时，为每个函数、构造函数和关键逻辑补充中文 NatSpec / 学习注释。
- 在项目目录执行 `forge fmt --check`、`forge build`、`forge test -vvv`；构建、缓存、广播记录及日志统一放在 `../output-tdd/vesting-24/`，不纳入版本控制。

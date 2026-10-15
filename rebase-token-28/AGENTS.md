# Rebase Token 练习规则

继承 [仓库规则](../AGENTS.md)，本目录实现年度通缩 ERC20 学习题。

- 使用 Solidity 0.8.24、Shanghai、优化器 200 次；复用 `../foundry-counter-09/lib` 中的 OpenZeppelin 和 forge-std，不安装新依赖。
- 初始 1 亿枚、18 位精度；一年为 365 天。任何人可调用 `rebase()`，一次补齐所有完整年份，逐年向下取整缩减 1%，不足一年回滚。
- 内部份额总量固定，转账移动份额，rebase 只更新总量与换算比例；授权以 Token 最小单位记录，不随通缩缩放。不提供额外增发、销毁或管理员入口。
- 源码在 `src/RebaseToken.sol`，测试在 `test/RebaseToken.t.sol`，本地部署在 `script/Deploy.s.sol`；每个自有函数、测试和部署入口写中文 NatSpec。
- 验证 `forge fmt --check`、`forge build`、`forge test -vv`、`forge script` 模拟和独立 Anvil 的转账、rebase、余额查询；脚本仅允许 chain ID 31337。
- 编译、缓存、广播和日志放 `../output-tdd/rebase-token-28/`；不读取私钥、不广播公共链、不提交本地产物。

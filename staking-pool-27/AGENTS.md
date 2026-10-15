# StakingPool 练习规则

继承 [仓库规则](../AGENTS.md)。实现 ETH 质押、按区块分配 KK，以及独立的 Compound cETH 加分版本。

- 使用 Solidity 0.8.24、Shanghai、Foundry；复用 `../foundry-counter-09/lib` 中的 OpenZeppelin 5.7.0 和 forge-std，不安装新依赖。
- 保持题面 `IStaking` 的五个接口。KK 使用 18 位精度，非空池每区块累计 10 KK；空池不积累可领取奖励，存取之前先结算，退出后仍可领取旧奖励。
- `StakingPool` 保管 ETH 本金；`CompoundStakingPool` 通过 cETH 的 `mint()` / `redeem()` 存取，并按各用户实际取得的 cETH 记录利息归属。借贷版 `unstake(amount)` 的 amount 指本金，实际 ETH 返还含该部分的市场收益。
- 所有自有函数、构造器、回调、测试和脚本写中文 NatSpec；金额、权限、重入、市场失败及 ETH 转账失败必须有测试。
- 部署用 `forge script`；默认只模拟或在隔离 Anvil 上操作，主网 fork 只修改本地副本，不签名或发送公共链交易。
- 运行 `forge fmt --check`、`forge build`、`forge test -vv`，并验证部署脚本和本地存取领奖；fork 成功与否单独报告。
- 编译、广播、测试日志统一放 `../output-tdd/staking-pool-27/`，不提交。README 解释收益计算、完整本地命令及实测范围。

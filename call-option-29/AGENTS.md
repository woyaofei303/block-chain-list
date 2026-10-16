# 看涨期权 Token 练习规则

继承 [仓库规则](../AGENTS.md)，本目录实现 ETH 全额抵押的 ERC20 看涨期权。

- 使用 Solidity 0.8.24、Shanghai、优化器 200 次，复用 `../foundry-counter-09/lib` 的 OpenZeppelin 与 forge-std。
- 每 1 ETH 发行 1 枚 18 位精度期权；部署者为固定发行方。部署时固定支付代币、每 ETH 行权价与未来 UTC 到期日零点，行权窗口为该日的 24 小时。
- 只在行权日之前发行；行权先销毁期权，再收取支付代币并发放 ETH，失败必须全部回滚。支付金额向上取整，拒绝转账扣费的支付代币。
- 到期后冻结转账，发行方分批遍历历史持有人、真实销毁余额并取回等量 ETH；不得提前回收、遗漏持有人或使用只隐藏余额的伪销毁。
- 源码在 `src/`，测试在 `test/`，本地部署及模拟在 `script/`；自有函数和入口使用简短中文 NatSpec。
- 完成 `forge fmt --check`、`forge build`、`forge test -vv`、脚本模拟与独立 Anvil 的发行、行权、过期赎回核验。部署脚本只允许 chain ID 31337。
- 编译、缓存、广播和临时日志放 `../output-tdd/call-option-29/`；交付截图放 `screenshots/`。不读取私钥，不广播公共链。

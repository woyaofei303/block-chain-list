# Token 投票治理工作规则

继承 [仓库规则](../AGENTS.md)，本文件适用于 `token-governance-30/`。

- 使用 Solidity 0.8.28、Cancun、Foundry，优化器 200 次。通过 remappings 复用 `foundry-counter-09/lib` 中的 OpenZeppelin 与 forge-std，不安装 Node 包；投票模块依赖 Cancun 的 MCOPY 指令。
- `src/GovToken.sol` 固定发行 1,000,000 GTK，使用 ERC20Votes 的委托与历史检查点；不得改成按投票时余额计票。
- `src/Gov.sol` 复用 Governor、GovernorVotes、GovernorCountingSimple。延迟 1 区块，投票期 20 区块，提案门槛 1 GTK；赞成加弃权须达到历史总量的 10%，且赞成严格多于反对。
- `src/Bank.sol` 保存 ETH，管理员构造后不可改变；部署时指定 Gov。资金属于 DAO 公共金库，不维护个人可提款余额。
- `test/` 覆盖 Token、提案到执行、权限、快照、时间边界、重复执行与失败回滚。测试和脚本中的自有入口保留中文 NatSpec。
- 在本目录执行 `forge fmt --check`、`forge build`、`forge test -vv`。部署使用 `forge script script/Deploy.s.sol:Deploy`，脚本仅允许 chain ID 31337；本地 Anvil 使用独立端口 19845 和解锁账户，不读取私钥。
- 所有缓存、广播回执和日志写入 `../output-tdd/token-governance-30/`。不接入前端、时间锁或可升级代理；20 区块是教学参数，不能直接用于真实资金治理。

# Flash Swap 练习规则

继承 [仓库规则](../AGENTS.md)。本项目完成两个 Uniswap V2 池之间的 A → B 闪电兑换。

- 自有合约、测试和脚本使用 Solidity 0.8.24 / Foundry；复用 09 的 forge-std、OpenZeppelin 及 25 的 V2 接口和编译产物，不下载新依赖。
- 先在 `../uniswap-v2-25` 执行 `forge build`，保留其 Factory、Pair、WETH9、Router02 的原编译设置和匹配的创建字节码哈希；本项目通过 JSON 产物部署，不跨版本导入实现。
- `src/MyToken.sol` 固定发行普通 18 位 ERC20；`src/FlashSwap.sol` 固定两 Factory、两币和池地址，只允许部署者发起 A → B 策略。
- 回调必须核验 Pair 和 swap 发起者；还款采用异币偿还公式，向上取整。利润必须来自本次兑换，亏损及未达到最低利润时整笔回滚。
- 测试覆盖实际 V2 合约、token0/token1 顺序、权限、边界和回滚。验证：`forge fmt --check`、`forge build`、`forge test -vv`，再完成隔离 Anvil 部署与交易核验。
- `script/` 支持本地 31337 与 Sepolia 11155111；公共链必须取得具体账户和费用授权后才能广播，不读取私钥。Anvil 记录不能作为 Sepolia 作业证据。
- 缓存、广播和执行日志放 `../output-tdd/flash-swap-26/`。README 给出操作与提交证据要求，不伪造测试网地址、交易哈希或上传状态。

# upgradeable-nft-market-21

继承 [仓库规则](../AGENTS.md)，本文件适用于整个项目。

- Solidity 0.8.24 / Foundry，EVM Cancun；不引入前端或 Node 包管理器。
- `src/` 为 ERC721 UUPS 实现、NFTMarket V1/V2 与测试支付代币；`test/` 验证交易、签名安全和升级状态；`script/` 提供部署与升级入口。
- 复用 `../foundry-counter-09/lib` 的 forge-std；本项目 `lib/` 固定保存成对的 OpenZeppelin Contracts / Contracts Upgradeable 5.7.0 所需原始源码及许可，不修改第三方文件。
- V2 继承 V1，禁止修改 V1 已有状态变量顺序和类型。实现合约锁定初始化；代理在构造交易内初始化；升级仅限 owner。
- 离线挂单使用 EIP-712，绑定链、代理、卖家、tokenId、价格、nonce 和截止时间。金额使用 uint256 最小单位。
- 验证：`forge fmt --check`、`forge build`、`forge test -vv`，以及独立 Anvil 上的 `forge script` 模拟、部署、升级和成交核验。
- 运行产物保存到 `../output-tdd/upgradeable-nft-market-21/`；README 中的测试网地址必须来自真实已确认交易，本地地址不得冒充测试网。
- 测试仅用虚拟账户。公共网络广播须先确认网络、公开账户、合约目标与费用上限；不读取私钥、现有环境文件或密码。

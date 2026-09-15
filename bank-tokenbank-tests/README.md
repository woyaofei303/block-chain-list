# Bank 与 TokenBank 测试

这是一个无第三方依赖的 Foundry 项目，包含 Bank 单元测试，以及基于 Sepolia fork 的 TokenBank USDT 存取测试。

## 测试范围

`test/Bank.t.sol` 包含 7 个测试：

1. 检查用户存款前后的 `deposits` 记账。
2. 分别检查 1、2、3、4 个用户时的存款前三名。
3. 检查同一用户多次存款后按累计金额排名，且排行榜中不重复出现。
4. 检查非管理员提款回退、管理员可以取出全部 ETH。

`test/TokenBankUSDTSepoliaFork.t.sol` 在 Sepolia 区块 `11706800` 上创建 fork，检查：

1. 当前链 ID 为 `11155111`。
2. 测试 Token 的 `symbol` 为 `USDT`、`decimals` 为 `6`。
3. 用户授权后可存入 `1,000 USDT`。
4. 用户可先取出 `400 USDT`，再取出剩余 `600 USDT`。
5. 每一步同时检查 TokenBank 内部记账和 USDT 实际余额。

测试使用 Aave V3 Sepolia 地址簿登记的 USDT 测试 Token：

```text
0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0
```

- [Aave V3 Sepolia 地址簿](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Sepolia.sol)
- [Sepolia Etherscan](https://sepolia.etherscan.io/token/0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0)

fork 中的账户模拟和转账只修改本地临时状态，不发送 Sepolia 交易，也不消耗测试币。

## 运行

需要安装 Foundry，然后执行：

```bash
cd bank-tokenbank-tests
forge test -vv
```

项目默认使用公开 Sepolia RPC。也可以覆盖为自己的 RPC：

```bash
SEPOLIA_RPC_URL=https://your-sepolia-rpc.example forge test -vv
```

最近一次完整通过日志见 [`test-results/forge-test.log`](test-results/forge-test.log)。

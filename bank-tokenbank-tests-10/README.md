# 10 · 给银行写测试：成功、失败和 fork

会手动存取款之后，下一步是让程序自动判断“改代码后有没有弄坏”。本项目分别测试 ETH Bank 和使用 Sepolia 测试 USDT 的 TokenBank。先读 [05](../bank-05/README.md) 与 [07](../tokenbank-07/README.md) 会更容易。

## 一项测试就是一次可重复的小实验

例如 Alice 存 1 ETH：先记录初始余额，再存款，最后断言个人历史增加 1、银行资产增加 1。**断言**是程序必须满足的条件，条件不成立就让测试失败。

权限也要反着试：普通用户提款应失败，而且银行资产不能减少。只测“管理员可以提款”不足以证明别人不能提款。

## 两组测试为什么分开

`BankTest` 在本地创建 Bank，不需要远程链数据，检查累计存款、1～4 人的前三名、追加存款和管理员提款。

`TokenBankUSDTSepoliaForkTest` 从 Sepolia 的固定区块 `11706800` 复制状态到本地，这叫 **fork**。真实链提供起点；之后的转账、模拟身份和合约部署只修改本地副本，不改变 Sepolia。

`vm.prank(Alice)` 让下一次调用在测试中表现为 Alice 发起。它是测试工具的能力，不能用来控制公共网络上的 Alice 钱包。

## 从第一条命令开始

准备 Foundry，从仓库根目录执行：

```bash
cd bank-tokenbank-tests-10
forge fmt --check
forge test --match-contract BankTest -vv
```

预期执行 Bank 的 7 项测试。无需启动 Anvil，也没有第三方合约库依赖；首次编译可能需要下载匹配的编译器。

再运行依赖网络的 fork 测试：

```bash
forge test --match-contract TokenBankUSDTSepoliaForkTest -vv
```

测试默认使用配置中的公开 Sepolia RPC；如需更换，在本地设置 `SEPOLIA_RPC_URL`，服务必须能读取该历史区块。RPC 超时或历史状态不可用属于运行条件问题，不能把它写成测试已通过。

```bash
forge test -vv
```

完整预期为 Bank 7 项、fork 1 项，共 8 项。只运行第一条 Bank 命令，不能宣称 fork 通过。旧日志在 [forge-test.log](test-results/forge-test.log)，2026-10-09 重新运行了本地 Bank 的 7 项测试并通过，未运行 Sepolia fork。

## 跟着 1,000 USDT 走一遍

本测试 USDT 合约为 `0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0`，精度是 **6**，不是常见的 18。因此：

```text
1,000 USDT = 1,000 × 10^6 = 1000000000 最小单位
400 USDT = 400000000 最小单位
600 USDT = 600000000 最小单位
```

`setUp()` 先创建 fork，核对 chain ID、符号和精度，部署银行，再模拟已有持币人给 Alice 1,000 USDT。随后测试按 `approve → deposit → withdraw(400) → withdraw(600)` 执行。

预期状态依次为：

```text
准备完成：Alice 钱包 1000；银行持币 0；Alice 可提 0
存款完成：Alice 钱包 0；银行持币 1000；Alice 可提 1000
部分提款：Alice 钱包 400；银行持币 600；Alice 可提 600
全部提款：Alice 钱包 1000；银行持币 0；Alice 可提 0
```

同时断言银行实际资产与个人账本，才能发现“只记账却没收币”的错误。转账返回 false 时交易会回滚；存款人不能提取别人的余额。

## 按这个顺序读代码

1. [Bank.t.sol](test/Bank.t.sol)：先看 `testDepositUpdatesUserBalance`，再看权限和排名。
2. [Bank.sol](src/Bank.sol)：对照测试理解 `deposits` 是历史记录，管理员提款不清空它。
3. [TokenBankUSDTSepoliaFork.t.sol](test/TokenBankUSDTSepoliaFork.t.sol)：读 `setUp`，再读存取断言。
4. [TokenBank.sol](src/TokenBank.sol)：看如何先检查额度/余额，再完成 Token 转移与记账。

进一步部署与查询见 [Sepolia 操作参考](USAGE.md)。它是公共链流程，不是运行这些测试的前置条件。

练习：预测“省略 approve 后直接 deposit”在哪一层失败，再在测试代码中定位相应调用。不要通过删断言或跳过 fork 来把失败变成绿色。

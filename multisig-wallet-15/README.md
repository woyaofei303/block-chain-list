# 15 · 多签钱包：三个人中两个人同意才能转钱

普通钱包由一把私钥决定转账；这里把钱放在合约里，由 Alice、Bob、Carol 三位持有人共同决定。门槛设为 2 时，至少两人分别确认同一提案才可执行。

本项目的确认是**链上交易**，没有离线签名收集。先掌握 [05 的权限与 ETH](../bank-05/README.md)，再学习“提交、确认、执行”三个阶段。

## 以转出 0.1 ETH 为例

钱包先有 1 ETH。Alice 提交“给 Dave 0.1 ETH”的提案，编号 0，确认数仍是 0；提交本身不自动投票，也不转钱。

Bob 确认后有 1 票，不能执行；Carol 确认后有 2 票，**允许执行但不会自动执行**。此时任意账户都能发起执行，包括不是持有人的人；它不能修改收款人和金额。

成功后钱包剩 0.9 ETH，Dave 收到 0.1 ETH，提案标记为已执行，不能再付第二次。执行交易的 Gas 由发起执行的钱包另付。

## 先运行完整行为测试

准备 Foundry，从仓库根目录执行：

```bash
forge fmt --root multisig-wallet-15 --check
forge build --root multisig-wallet-15
forge test --root multisig-wallet-15 -vv
forge test --root multisig-wallet-15 --match-test testEthTransferPermissionsThresholdAndReplay -vvvv
```

最后一条显示更细的调用轨迹，适合对照 1 ETH 到 0.9 ETH 的变化。测试用本地 EVM 模拟身份，不需要 Anvil、RPC 或私钥。编译器是 `0.8.24`、EVM `shanghai`、关闭优化。

## 再在 Remix VM 亲手完成

1. 导入 [MultiSigWallet.sol](src/MultiSigWallet.sol)，使用上述编译配置。选择 Remix VM。
2. 选三个不同模拟地址 A、B、C，再选 D 负责执行、E 负责收款。部署的 `initialOwners` 填三人地址数组，`requiredConfirmations` 填 2，Value 为 0。
3. 用空 calldata 向钱包发送 `1 Ether`，触发 `receive()`；随后 Value 归零。
4. A 调 `submitTransaction(E, 100000000000000000, 0x)`。金额是函数参数里的 Wei，不要填进 Value。
5. 查询 `transactions(0)`，应为 E、0.1 ETH 对应整数、`0x`、`false`、`0`。
6. B 调 `confirmTransaction(0)`。此时执行应因 `Not enough confirmations` 失败；C 再确认，票数为 2。
7. D 调 `executeTransaction(0)`。查询钱包余额和 E 的余额差：钱包 0.9 ETH，E 增加 0.1 ETH；D 支付 Gas。
8. 再执行应报 `Transaction already executed`，不能再次转走资金。

第一次提案编号才是 0；后续从 `SubmitTransaction` 事件获取各自编号。部署参数数组格式为：

```text
["A的完整地址", "B的完整地址", "C的完整地址"]
```

当前项目没有 `script/` 部署入口；本篇用已有 Forge 测试与 Remix VM 完成学习，不提供不存在的脚本命令。

## 沿着状态变化读源码

[MultiSigWallet.sol](src/MultiSigWallet.sol) 的构造函数先拒绝零地址、重复持有人和非法门槛。部署者只有列入持有人数组才有提交和确认权限。

`submitTransaction` 保存目标、金额和 calldata（发给目标函数的编码数据）；`confirmTransaction` 按提案和持有人记录投票，重复确认不增加票数；`executeTransaction` 最后检查门槛和实际资金。

执行前先标记已执行，再调用外部目标，避免目标回调重复执行同一提案。若目标回滚或余额不足，本次执行回滚，原有确认票保留；补足条件后可以重试。

但目标函数若**返回 false 而不回滚**，底层 `call` 仍可能视为成功。本钱包不解析业务返回值，确认提案前必须理解目标函数语义。

## 用失败情况检查理解

- 只有 Bob 一票：执行失败，1 ETH 留在钱包。
- Bob 确认两次：第二次失败，不能冒充两个人。
- 目标拒绝收款：不丢钱，提案仍可在条件修复后重试。
- 两个提案：分别计票，不能拿 0 号的确认去执行 1 号。

这份教学钱包固定持有人和门槛，没有改人、撤票、取消或过期功能。两票确认后没有撤销入口。2026-10-09 已通过 9 项 Forge 测试，没有向公共链发送交易。

## 历史验证记录

2026-09-22 在 Foundry `1.8.1`、Solidity `0.8.24` 的本地环境运行：9 项测试通过，0 失败，0 跳过。没有部署或广播到公共链，没有使用真实资金。

同日补充命令行实测：按当时的命令行教程在独立 Anvil（`127.0.0.1:18555`、Chain ID `31337`）完成部署、充值、提案、B/C 确认和非持有人执行。钱包余额从 `1` 变为 `0.9 ETH`，独立收款账户增加 `0.1 ETH`，提案最终为 `executed = true`、确认数 `2`；一票执行和重复执行的只读模拟均按预期拒绝。验证后已停止当时 Anvil。

临时命令输出与回执保存在仓库的 `output-tdd/multisig-wallet-15/`，不纳入提交。当时的 Sepolia 命令仅完成本地参数与 Shell 语法核对，未连接公共 RPC、解锁真实账户或广播公共链交易。

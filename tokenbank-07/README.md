# 07 · TokenBank：授权、存入、取出一笔代币

ETH 可以随交易直接发送；ERC20 代币的余额却记录在代币合约里。这个项目让你发行一份代币，再把 10 枚存入银行、取出 4 枚，理解两个合约怎样合作。

先了解 [05 的 ETH 银行](../bank-05/README.md)。这里的 `balances` 是当前可提余额，与 05 的历史累计存款不同。

## 用“100 → 90 → 94”看清三本账

假设 Alice 钱包有 100 枚代币。给银行授权 10 枚后，钱包仍是 100：`approve` 只是许可，不是付款。

存入 10 枚后，钱包剩 90，银行持有 10，银行记录 Alice 可提 10。取出 4 枚后，钱包是 94，银行持有 6，Alice 可提 6。再次取 7 枚会失败，三个数字都不应改变。

代币 `decimals = 18`，即一枚对应 `10^18` 个最小单位。函数参数用最小单位；Remix 的 **Value 始终保持 0 Wei**，因为这里转的是代币而非 ETH。

## 第一次操作：在 Remix VM 完成闭环

导入 `contracts/`、`tests/`。编译器选 `0.8.24`，目标 `shanghai`，关闭优化；选择 Remix VM，不需真实钱包。

1. 用 A 部署 `BaseERC20`，记地址 T。它发行一亿枚 BERC20，全部给 A，没有后续增发入口；所以上面的 100 枚只是便于计算的例子。
2. 部署 `TokenBank`，构造参数填 T，记银行地址 B。不要部署文件内的 `IERC20` 接口。
3. 在 **Token** 上调用 `approve(B, 10000000000000000000)`，授权 10 枚。
4. 在 **Bank** 上调用 `deposit(10000000000000000000)`。
5. 查询 `Bank.balances(A)` 和 `Token.balanceOf(B)`，新实例中都应为 10 枚的最小单位数。
6. 在 Bank 调 `withdraw(4000000000000000000)`，个人可提余额应剩 `6000000000000000000`。
7. 再取 7 枚应失败；取剩余 6 枚应成功，账本归零。

更多双账户操作和每一步结果见 [Remix 操作指南](REMIX_GUIDE.md)。

## 钱和账怎样一起变化

```text
A → Token.approve(B, amount)：Token 记录 A 给 B 的额度
A → Bank.deposit(amount)
    Bank → Token.transferFrom(A, Bank, amount)
    Bank 增加 balances[A] 和 totalDeposits
A → Bank.withdraw(amount)
    Bank 先扣余额，再由 Token.transfer 把币转回 A
```

银行调用 Token 时，Token 看到的调用者是银行，所以授权对象必须是银行地址。提款花的是银行自己的代币，不需要用户再次授权。

如果转账失败，整笔交易回滚，扣账也会撤销。直接 `Token.transfer(B, amount)` 只增加银行持币量，不会执行 `deposit`，因此不会增加个人可提余额。

## 进阶：自动划转会减少个人可提余额

当前版本还供 [23 的 CRE 自动化](../cre-project-23/README.md) 使用。owner 可以设置 Receiver 合约；owner 或该 Receiver 可调用 `withdrawhalf(recipient)`，划转已记账存款的一半，并分摊扣减个人余额。

例如 Alice 可提 10、Bob 可提 6，总计 16；划出 8 后，两人分别剩 5、3。最小单位出现奇数时，通过进位分摊保证总扣款恰为 `floor(totalDeposits / 2)`，单个用户与半额的差不超过一个最小单位。

直接转入但未记账的代币不参与这次半额计算。最多允许 100 个历史存款人，提现后也不会释放历史名额；这是限制遍历成本的教学实现。

## 对照代码与测试

- [BaseERC20.sol](contracts/BaseERC20.sol)：从 `approve`、`transferFrom` 理解授权由谁消费。
- [TokenBank.sol](contracts/TokenBank.sol)：从 `deposit`、`withdraw` 看资产与账本，再读 `withdrawhalf`。
- [TokenBank_test.sol](tests/TokenBank_test.sol)：在 Remix 的 Solidity Unit Testing 插件运行，检查个人隔离、失败回滚和自动划转。

银行适配本项目无转账手续费、无 rebase 的代币，不能据此假定兼容所有 ERC20。2026-10-09 已本地编译 `contracts/`；未重新运行 Remix 测试或部署公共链。

**历史运行结果（2026-09-10）：** 修改自动化入口之前，Remix `2.5.7`，工作区 `tokenbank`，Solidity `0.8.24`，EVM `shanghai`，Optimization 关闭；编译成功，**Passed: 5，Failed: 0，Time Taken: 0.48 s**。自动化入口修改后的 Remix 浏览器测试未重跑，不能沿用这条历史结果宣称 6 组通过。

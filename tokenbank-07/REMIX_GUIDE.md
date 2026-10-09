# TokenBank 实操：存 10、取 4、验证不能多取

先读 [README](README.md)。本文每次操作都写清“哪个账户、哪个合约、哪个参数”。只用 Remix VM 的模拟资产；A 是部署者，B 是另一位用户，T 是 Token 地址，K 是银行地址。

## 1. 导入并部署

在 Remix 导入 `contracts/` 和 `tests/`，保持目录结构。编译器 `0.8.24`，EVM 目标 `shanghai`，关闭优化。Deploy & Run 选择 Remix VM，后续 **Value 全程为 0 Wei**。

1. A 部署 `BaseERC20`，记下 T。A 得到一亿枚，精度 18。
2. A 部署 `TokenBank`，构造参数填 T，记下 K。不要选接口 IERC20。
3. 查询 `K.token()`，必须返回 T；`T.decimals()` 应为 18，`K.balances(A)` 应为 0。

准备一个本地笔记记录 A、B、T、K 的完整公开地址。它们都以 0x 开头，但不是同一种对象；切换 VM 或重新部署后需更新记录。

## 2. 授权：钱还没动

当前账户 A，在 **T** 上调用：

```text
approve
spender = K 的完整地址
value = 10000000000000000000
```

这表示允许银行使用 10 枚。再查询 `allowance(A,K)`，应为同一个整数。A 的钱包余额不变，银行存款仍为 0。

不要把 spender 写成 A 或 T；真正执行 `transferFrom` 的是 K。再次 approve 会覆盖该 spender 的原额度，不是自动相加。

## 3. 存入：同时检查资产和账本

仍是 A，在 **K** 上调用：

```text
deposit
amount = 10000000000000000000
```

等待交易成功，再读：

```text
T.balanceOf(A) = 初始余额减 10 枚
T.balanceOf(K) = 10 枚
K.balances(A)  = 10 枚
K.totalDeposits() = 10 枚
T.allowance(A,K) = 0
```

A 调银行，银行再调 T 的 `transferFrom(A,K,amount)`。Token 看到的调用者是 K，所以消费 A 给 K 的额度。收币失败则银行记账也不发生。

## 4. 取出 4，再故意多取

在 **K** 上调用 `withdraw`，参数：

```text
4000000000000000000
```

成功后 A 收回 4，银行持币与个人可提都剩 6。提款不需要再 approve，因为转出的是银行自己持有的 Token。

再尝试取 7，参数 `7000000000000000000`，预期 `Insufficient deposited balance`。查询个人余额与银行资产仍应是 6。最后取 `6000000000000000000`，二者归零。

## 5. 两个人共用一家银行

A 在 T 上给 B 转 20 枚：`transfer(B,20000000000000000000)`。这只是钱包间转账，双方银行账本都不会自动变化。

切 B，在 T 授权 K 10 枚，再在 K 存 10。切 A，重新授权并存 6。现在应看到：

```text
K.balances(A) = 6 枚
K.balances(B) = 10 枚
T.balanceOf(K) = 16 枚
```

A 取 7 仍应失败，不能把银行总资产当作自己的额度。A 取 6、B 取 10 后，银行清空；分别查询两个账户，而不是只看最后连接的那个人。

## 6. 三个常见失败怎么定位

**忘记授权。** B 有币也可能存不进去。查 `allowance(B,K)`，不足时报 `ERC20: transfer amount exceeds allowance`；先确认没有把 K 填错。

**授权足够但没那么多币。** B 若只有 20，授权 21 再存 21，应报 `ERC20: transfer amount exceeds balance`。失败后钱包、存款和额度应保持调用前状态。

**直接把币转给银行。** `T.transfer(K,amount)` 不调用 deposit；只增加银行实际持币，不增加个人可提。本项目没有认领接口，此实验用另一组模拟实例，别污染上面的余额核对。

银行还拒绝零金额、空余额提款，以及没有代码的 Token 地址。地址合法并不意味着它是你需要的合约。

## 7. 自动化扩展单独理解

当前代码多了 `withdrawhalf`。owner 或被配置的 Receiver 划出总存款的一半时，也分摊扣减个人可提额；不是一边转走钱一边保留全额欠款。

例如 A 可提 6、B 可提 10，划转后是 3、5，总计 8。主流程不需要调用这个入口；想练自动触发，继续 [23 CRE](../cre-project-23/README.md)。不要在主流程中途调用后还期待原来的余额。

## 8. 运行插件测试并核对证据

启用 Remix 的 Solidity Unit Testing，选 `tests/TokenBank_test.sol` 运行。`remix_tests.sol` 是插件提供的文件，不需要在本地安装 Foundry 来凑这个导入。

当前六组测试覆盖：发行与 ERC20、存取款、权限与用户隔离、输入与直接转账、返回 false 的回滚重试、自动半额划转。每组创建新的 Token 和 Bank，避免互相污染。

历史记录：2026-09-10、自动化入口加入前，Remix 2.5.7 下为 5 passed、0 failed、0.48 秒；**不能据此宣称当前六组已在浏览器通过**。本次文档重构未重新运行。

回执看调用账户、合约、参数和事件，再读余额：Approval / Transfer 来自 T，Deposited / Withdrawn 来自 K。查询本身不发业务事件。

课程若要求代码，可使用 [TokenBank.sol](contracts/TokenBank.sol) 完整文件；若要求链接，可使用 [项目地址](https://github.com/woyaofei303/block-chain-list/tree/main/tokenbank-07)。本次没有提交答案或执行公共链部署。

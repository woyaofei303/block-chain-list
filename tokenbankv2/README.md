# ERC20 Hook 与 TokenBankV2

在 ERC20 转账后通知接收合约，让用户通过一次 `transferWithCallback` 完成转账和银行存款记账。使用 **Solidity 0.8.24 + Remix VM + Solidity Unit Testing**，不使用 Foundry，不需要安装本地依赖。

从这里开始：[Remix 完整交互流程](REMIX_GUIDE.md)。文档包含导入、编译、部署、免授权存款、提款、多用户验证、旧存款方式和失败场景。

## 1. 文件与继承关系

```text
tokenbankv2/
├── contracts/
│   ├── BaseERC20.sol           原项目基础 ERC20
│   ├── ERC20WithCallback.sol   继承 BaseERC20，定义接收接口并新增 Hook 转账
│   ├── TokenBank.sol           原项目银行
│   └── TokenBankV2.sol         继承 TokenBank，实现 tokensReceived
├── tests/
│   ├── HookHelpers.sol         模拟另一位用户、接受或拒绝回调的接收合约
│   └── TokenBankV2_test.sol    六组 Remix Solidity 测试
├── README.md
└── REMIX_GUIDE.md
```

`BaseERC20.sol`、`TokenBank.sol` 原样复用仓库 `tokenbank/contracts/` 的源码，在新目录保留副本以便独立导入 Remix。所有新增行为通过继承实现，原项目不需要修改。

```text
BaseERC20 ──继承──> ERC20WithCallback
TokenBank ──继承──> TokenBankV2 ──实现──> ITokenReceiver
```

实际只部署 `ERC20WithCallback` 和 `TokenBankV2`。父合约和接口不需要单独部署。V2 是一个新银行实例，继承的是代码；不会迁移旧银行的地址、代币或存款账本。

## 2. 为什么新增 Hook

ERC20 普通转账只修改 **Token 合约自己的余额映射**。即使收款地址属于银行，也不会自动执行银行的 `deposit`。因此银行可能持有币，却不知道应该给谁增加可提余额。

旧流程需要两笔交易：

```text
用户 → Token.approve(银行, amount)
用户 → Bank.deposit(amount)
       Bank → Token.transferFrom(用户, 银行, amount)
       Bank → balances[用户] += amount
```

新流程只需用户发起一笔交易：

```text
用户 → Token.transferWithCallback(银行, amount)
       ① 扣减用户 Token 余额，增加银行 Token 余额，发出 Transfer
       ② 检查银行地址的 code.length > 0
       ③ Token → Bank.tokensReceived(用户, amount)
                  检查调用者是绑定的 Token
                  balances[用户] += amount，发出 Deposited
                  返回 true
       ④ transferWithCallback 返回 true
```

Hook 不是浏览器异步通知，也不是监听事件后再发一笔交易；它是**同一笔链上交易里的同步合约调用**。回调拒绝时，前面的转账、记账、接收方状态和事件一起回滚。

## 3. 接口和调用者

本练习约定以下接口，`from` 和 `amount` 让银行知道为谁记多少账，布尔返回值让接收方明确接受或拒绝：

```solidity
function transferWithCallback(address to, uint256 amount) external returns (bool);
function tokensReceived(address from, uint256 amount) external returns (bool);
```

这是自定义扩展，不是完整的 ERC777 或 ERC1363 实现；接收方需实现本项目约定的 ABI。

```text
进入 Token.transferWithCallback：msg.sender = 用户
内部执行 super.transfer：       msg.sender = 用户（内部调用保留调用者）
进入 Bank.tokensReceived：      msg.sender = Token，from = 用户
```

银行用 `msg.sender == address(token)` 验证通知来源，用 `balances[from]` 记录存款。若直接使用 `balances[msg.sender]`，余额会记到 Token 合约名下；若使用 `tx.origin`，通过合约钱包存款时会记错人。

`tokensReceived` 中只记账，不能再次调用 `deposit` 或 `transferFrom`：Token 已经转过来了。Hook 路径不需要授权，也不消耗已有授权；旧的 `approve + deposit` 仍可使用，两条路径共享继承的 `balances`。

提款继续调用父合约的 `withdraw(amount)`：先扣减个人账本，再让银行调用普通 `Token.transfer` 转出自己的币。提款不需要用户授权，也不触发本项目的回调。

## 4. 代币参数与边界

扩展合约沿用父合约参数，没有重新发行第二种 Token：

```text
部署合约：ERC20WithCallback
name：BaseERC20
symbol：BERC20
decimals：18
总量：100000000000000000000000000（100,000,000 枚）
初始持有人：部署 ERC20WithCallback 的账户
```

- 无运行时代码的地址：只转账；零数量转账也允许。
- 有代码且实现接口的地址：转账后调用 Hook，必须返回 `true`。
- 接收方返回 `false`、主动 `revert` 或缺少正确接口：整笔转账回滚。
- 银行只接受绑定 Token 的通知，拒绝零金额存款、零金额提款和超额提款。
- 普通 `transfer`、`transferFrom` 保持父合约语义，不触发 Hook。直接 `transfer` 到银行仍然不计入个人存款，本项目没有找回该误转余额的入口。
- `code.length` 检查的是当前代码；构造中的合约代码长度为零，不能把这个判断当成可靠的“真人账户认证”。应在银行部署完成后再调用 Hook 转账。[Solidity 地址代码说明](https://docs.soliditylang.org/en/v0.8.24/types.html#members-of-addresses)

银行信任部署时绑定的本项目 Token：无手续费、无 rebase，且回调由真实转账触发。构造函数只检查地址有代码，不会认证一个任意 Token 是否诚实。如果换成恶意 Token，单靠来源地址校验不能证明币已经到账。当前回调仅写账、发事件，无外部调用；转账先更新余额再回调，提款先扣账再转币。

## 5. Remix 验证

按 [完整交互流程](REMIX_GUIDE.md) 导入 `contracts`、`tests`，选择：

```text
Compiler：0.8.24+commit.e11b9ed9
EVM Version：shanghai
Optimization：关闭
手动交互环境：Remix VM
测试插件：Solidity Unit Testing
测试文件：tests/TokenBankV2_test.sol
```

六组测试覆盖：

1. `callbackDepositAndWithdraw`：无需授权存款、记到原始用户、部分和全部提款。
2. `eoaAndContractReceiver`：无代码地址、零转账、合约回调参数、先到账后回调、仅调用一次。
3. `legacyDepositAndUserIsolation`：旧存款入口、两种存款累加、Hook 不消耗授权、合约用户余额隔离。
4. `forgedCallbacksAndInvalidAmounts`：伪造通知、错误 Token、零金额、超额提款及状态保持。
5. `rejectedCallbacksRollBack`：返回 false、revert、缺少接口时，币和接收方状态都回滚。
6. `plainTransferAndAddressChecks`：普通转账不记账、零地址、余额不足和无效 Token 地址。

测试结果记录见 [交互流程的验证记录](REMIX_GUIDE.md#7-自动化测试与验证记录)。这些测试调用公开接口并使用 Remix 模拟环境，不需要钱包或公共网络交易。[Remix Solidity Unit Testing 文档](https://remix-ide.readthedocs.io/en/latest/unittesting.html)

题目关联：[原 TokenBank 题目](https://decert.me/quests/eeb9f7d8-6fd0-4c38-b09c-75a29bd53af3)。当前交付依据本次给出的 Hook 要求和仓库现有 TokenBank 实现。

# TokenBank：ERC20 与代币存取练习

本项目位于现有仓库的 `tokenbank/`，沿用其他合约练习的 Remix 开发方式。

当前状态：ERC20、TokenBank 及 Remix 测试已实现；在 Remix 中编译成功，五组测试全部通过。只使用 Remix 验证，未部署到公共网络，也未提交答题表单。下文区分网页题目要求、图片补充要求和本项目实现。

## 1. 编写 ERC20 token 合约

- [题目主页](https://learnblockchain.cn/quest/aa45f136-27a3-4bc9-b4f7-15308e1e0daa)
- [完整题目及代码模板](https://learnblockchain.cn/quest/aa45f136-27a3-4bc9-b4f7-15308e1e0daa/challenging)

网页要求补全 `BaseERC20` 模板，固定信息如下：

```text
合约名称：BaseERC20
name：BaseERC20
symbol：BERC20
decimals：18
题面总量：100,000,000
初始接收者：部署者（模板将 totalSupply 赋给 balances[msg.sender]）
```

需要实现五个接口：

- `balanceOf(owner)`：查询账户余额。
- `transfer(to, value)`：调用者向接收者转账。
- `approve(spender, value)`：设置 spender 可使用的额度。
- `allowance(owner, spender)`：查询授权额度。
- `transferFrom(from, to, value)`：调用者使用 from 授予自己的额度转账。

模板已声明 `Transfer`、`Approval` 事件，并在转账、授权函数末尾发出相应事件及返回 `true`。题目要求在指定位置补全代码，保留既有模板结构。

题目明确要求使用 `require`，以下报错文本需保持一致：

```text
transfer / transferFrom 余额不足：
ERC20: transfer amount exceeds balance

transferFrom 授权不足：
ERC20: transfer amount exceeds allowance
```

**总量单位的解释：** 题面写了总量与精度，但没有明确写出缩放公式。若按“发行一亿枚可展示的代币”理解，依据 [ERC20 的 decimals 定义](https://eips.ethereum.org/EIPS/eip-20#decimals)，链上最小单位总量应为 `100_000_000 * 10 ** 18`，即 `100000000000000000000000000`。这是实现时的单位解释，不应误称为题面给出的公式。

## 2. Solidity 编写 TokenBank

- [题目主页](https://learnblockchain.cn/quest/eeb9f7d8-6fd0-4c38-b09c-75a29bd53af3)
- [完整题目](https://learnblockchain.cn/quest/eeb9f7d8-6fd0-4c38-b09c-75a29bd53af3/challenging)

网页要求：

1. 将自己编写的 Token 存入 TokenBank，并能取出。
2. `deposit()` 记录各地址存入的数量。
3. `withdraw()` 允许用户取回自己此前存入的 Token。
4. 答题框接受合约代码或 GitHub 链接。

网页只列出方法名称，没有规定参数、构造函数、余额映射名称或具体报错文本。本项目采用 `deposit(uint256 amount)`、`withdraw(uint256 amount)`，部署时传入 Token 地址；这些是实现选择，并非题目指定的完整 ABI。

## 3. 两题如何衔接

第一题提供代币，第二题使用该代币完成合约间调用。实际交互顺序如下，`amount` 均为代币最小单位：

```text
用户 → Token.approve(TokenBank 地址, amount)
用户 → TokenBank.deposit(amount)
       TokenBank → Token.transferFrom(用户, TokenBank 地址, amount)
       TokenBank 记录该用户可取出的余额

用户 → TokenBank.withdraw(amount)
       TokenBank 扣减该用户余额
       TokenBank → Token.transfer(用户, amount)
```

`approve` 只授予额度，不转移代币；存款时调用 Token 的是 TokenBank，因此授权对象应为 TokenBank。提款由 TokenBank 转出其持有的代币，不需要用户再次授权。相关接口语义见 [ERC20 标准](https://eips.ethereum.org/EIPS/eip-20)。

银行中的余额应表示“累计存入减去累计取出”的当前可提余额。用户直接调用 Token 的 `transfer` 向银行地址转账，不会自动执行银行的 `deposit` 记账。

实现会检查代币转账结果，失败时回滚记账。提款先检查个人余额、扣账，再调用代币转账。[ERC20 标准明确要求处理返回的 false](https://eips.ethereum.org/EIPS/eip-20#methods)。

## 4. 项目结构与实现规则

```text
tokenbank/
├── contracts/
│   ├── BaseERC20.sol
│   └── TokenBank.sol
├── tests/
│   ├── TokenBankHelpers.sol
│   └── TokenBank_test.sol
└── README.md
```

- [BaseERC20.sol](contracts/BaseERC20.sol)：发行一亿枚、18 位精度的 BERC20，全部分配给部署者；无后续增发入口。遵循题目接口与报错要求，本地版本将公共转账逻辑集中在 `_transfer`。
- [TokenBank.sol](contracts/TokenBank.sol)：文件内包含所需的 `IERC20` 接口，可将整个文件直接复制到答题框。代币地址部署时固定，`balances(address)` 返回用户当前可提余额；无管理员提款功能。
- [TokenBank_test.sol](tests/TokenBank_test.sol)：五组 Remix 测试。每组重新部署 Token 和 Bank，避免状态相互影响。
- [TokenBankHelpers.sol](tests/TokenBankHelpers.sol)：模拟第二位存款人，以及返回 `false` 的代币调用。

银行拒绝零金额、超出个人存款余额的提款，以及零地址或没有合约代码的 Token 地址。存款和提款分别发出 `Deposited`、`Withdrawn` 事件。

该银行按本项目 BaseERC20 的行为记账：转账没有手续费、不自动改变持有人余额（rebase），并返回布尔值。其他特殊代币需要另行适配。直接向银行地址转 Token 不会记入个人存款，因此操作时使用 `approve` + `deposit`。

## 5. 只在 Remix 编译与验证

1. 打开 [Remix](https://remix.ethereum.org/)，本次入口跳转至 [app.remix.live](https://app.remix.live/)。创建空工作区 `tokenbank`。
2. 用文件面板的 **Create → Upload folders** 导入本项目的 `contracts`、`tests` 两个文件夹，保留目录结构。
3. Solidity Compiler 选择 `0.8.24+commit.e11b9ed9`；Advanced Configurations 中 EVM Version 选 `shanghai`，Optimization 关闭。
4. 打开 `contracts/TokenBank.sol` 并编译。部署时选 `TokenBank`，不要选择接口 `IERC20`。
5. 在 Plugins 中启用 **Solidity unit testing**，测试目录选择 `tests`，勾选 `tests/TokenBank_test.sol`，点击 **Run**。
6. `remix_tests.sol` 由插件提供，不需要安装本地依赖。测试在 Remix 的模拟环境中创建和调用合约，不需要连接钱包。

**2026-09-10 实际运行结果：** Remix `2.5.7`，工作区 `tokenbank`，Solidity `0.8.24`，EVM `shanghai`，Optimization 关闭；编译成功，**Passed: 5，Failed: 0，Time Taken: 0.48 s**。

通过的测试：

1. `initialStateAndTokenRules`：名称、符号、精度、总量、初始余额、自转账、零转账、覆盖授权、消耗授权及转账失败回滚。
2. `depositAndWithdraw`：授权后存款、追加存款、部分提款、全部提款，以及 Token 实际余额。
3. `authorizationAndUserIsolation`：未授权存款、Token 余额不足、超额提款、禁止提取他人余额，以及失败时状态不变。
4. `invalidInputsAndDirectTransfer`：零金额、空余额提款、无效 Token 地址，以及直接转账不自动记账。
5. `failedTransfersRollBackAndCanRetry`：转账返回 `false` 时存款不入账、提款扣账回滚，恢复后可重新提款。

## 6. Remix VM 手动复现与提交

以下是可复现的操作步骤；上述实际验证记录来自自动化测试，不代表已经单独完成本节手动操作。

1. 编译 `BaseERC20.sol`，在 Deploy & Run 选择 **Remix VM**，部署 `BaseERC20`，复制 Token 地址。
2. 编译 `TokenBank.sol`，选择 `TokenBank`，构造参数填写 Token 地址，再部署银行。
3. 在 Token 上调用 `approve(银行地址, 10000000000000000000)`，授权银行使用 10 枚 Token。
4. 在银行上调用 `deposit(10000000000000000000)`；查询 `balances(当前账户)`，应为 `10000000000000000000`。
5. 调用 `withdraw(4000000000000000000)` 提取 4 枚，剩余可提余额应为 `6000000000000000000`。
6. 调用 `withdraw(6000000000000000000)` 提取剩余 6 枚，可提余额归零。所有操作的 **Value 保持 0 Wei**，Token 数量填写在函数参数中。

答题时可复制 `contracts/TokenBank.sol` 的完整内容，或填写本项目的 [GitHub 链接](https://github.com/woyaofei303/block-chain-list/tree/main/tokenbank)。

图片额外提到部署 ERC20，但未指定网络。当前完成范围为合约实现与 Remix 模拟验证，公共网络部署尚未执行。

解析日期：2026-09-10。两个链接及各自的完整题目均已通过浏览器读取；本次未提交答案或调用 AI 判题。

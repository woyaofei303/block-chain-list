# TokenBank：Remix 完整操作流程

本文对应本项目的 [BaseERC20](contracts/BaseERC20.sol) 和 [TokenBank](contracts/TokenBank.sol)，说明从环境准备到作业提交的完整过程。全程使用 Remix VM，账户、地址和数值按步骤记录及核对。

需要导入 Remix 的源码与测试文件：

```text
contracts/
├── BaseERC20.sol
└── TokenBank.sol
tests/
├── TokenBankHelpers.sol
└── TokenBank_test.sol
```

## 1. 准备环境、账户与金额

下面按一组新部署的 Token 和 Bank 从头演示，顺序为：部署代币 → 部署银行 → A 授权并存入 10 枚 → 分两次取出 → A、B 同时存款并分别提款 → 异常验证 → 自动化测试 → 提交作业。

**本节之后的手动操作和数值是复现步骤及预期结果，不是已经执行的交易记录。** 实际通过的 Remix 自动化测试记录单列在第 6 节。若继续使用有历史交易的实例，应先查询现有余额，不能直接套用新实例的初始数值。

### 1.1 导入项目并设置编译器

1. 打开 [Remix](https://remix.ethereum.org/)，入口可能跳转到 [app.remix.live](https://app.remix.live/)。已有 `tokenbank` 工作区时直接使用；首次操作时创建空工作区 `tokenbank`。
2. 在 Files 面板选择工作区根目录，通过 **Create → Upload folders** 分别导入本项目的 `contracts`、`tests` 文件夹。目录结构与上面的文件清单保持一致。
3. 若手动复制代码，保留四个 Solidity 文件的名称和相对位置。不要把 `tests` 建在 `contracts` 内，也不要把本文当成 Solidity 源码。
4. 在 Solidity Compiler 中选择以下配置，然后分别编译两个业务合约：

```text
Compiler：0.8.24+commit.e11b9ed9
Language：Solidity
Advanced Configurations → EVM Version：shanghai
Optimization：关闭
```

先选中源码文件，再点 Compile。编译会生成该文件中合约的 ABI 和字节码；**编译不会部署，也不会修改之前部署的实例**。编译与部署入口见 [Remix Deploy & Run 文档](https://remix-ide.readthedocs.io/en/latest/run.html#deploying-a-contract)。

### 1.2 选择模拟环境，记录四个地址

进入 Deploy & Run，Environment 选择 **Remix VM**，不要切换到浏览器钱包。若界面提供独立的 VM 版本选择，可选择 Shanghai；也可使用支持 Shanghai 字节码的较新 VM。编译器的 EVM 目标仍保持上述 `shanghai`。

```text
Account：先选择列表中的第一个账户，记为 A
Value：0 Wei，部署、授权、转账、存款、提款全程保持为 0
Gas Limit：保留 Remix 默认值
```

Remix VM 是浏览器内的模拟链，不需要钱包签名。Account 旁显示的是用于模拟交易费用的 ETH 余额，不是本项目的 BERC20 余额。[Remix VM 说明](https://remix-ide.readthedocs.io/en/latest/run.html#remix-vm)

复制完整的 `0x` 地址，记录如下。A、B、T、K 都只是本文代号，不能把字母直接填入 Remix 的地址参数：

```text
A：第一个账户的完整地址，也是本例的 Token 部署者
B：第二个账户的完整地址，用于多用户验证
T：部署 BaseERC20 后得到的 Token 合约地址
K：部署 TokenBank 后得到的银行合约地址
```

### 1.3 认识金额和三种余额

本代币精度为 18，输入金额时使用整数最小单位；下面右侧数字可以直接复制：

```text
1 枚：1000000000000000000
4 枚：4000000000000000000
6 枚：6000000000000000000
7 枚：7000000000000000000
10 枚：10000000000000000000
20 枚：20000000000000000000
21 枚：21000000000000000000
一亿枚：100000000000000000000000000
```

Token 数量填在函数的 `amount` 或 `value` 参数中，**不是 Deploy & Run 顶部的 Value 输入框**。例如 `approve` 的 `value` 参数表示授权多少 Token；顶部 Value 表示随交易发送多少 ETH。

每次交易后要区分这三种查询：

- `BaseERC20.balanceOf(A)`：A 地址实际持有的 Token。
- `BaseERC20.balanceOf(K)`：银行地址实际持有的 Token，可能包含多人存款。
- `TokenBank.balances(A)`：银行账本中 A 当前可以提取多少 Token。

`allowance(A, K)` 是可代扣额度，不是另一份余额。余额查询属于只读调用；`approve`、`transfer`、`deposit`、`withdraw` 会发起交易。展开函数后按参数名分别填写，地址和整数不需要引号。[Remix 函数交互说明](https://remix-ide.readthedocs.io/en/latest/udapp.html#functions)

## 2. 部署两个业务合约

### 2.1 用账户 A 部署 BaseERC20

1. 在 Files 中打开 `contracts/BaseERC20.sol`，点击 Compile，确认没有编译错误。
2. 回到 Deploy & Run，Account 保持 **A**，合约选择 **BaseERC20**。
3. 构造函数没有参数，Value 保持 `0 Wei`，点击 **Deploy**。
4. 在 Deployed Contracts 中展开新生成的 BaseERC20 实例，复制其地址作为 **T**。
5. 在该实例中依次点击查询按钮。`balanceOf` 的 `owner` 参数填写 A 的完整地址。

```text
name()        → BaseERC20
symbol()      → BERC20
decimals()    → 18
totalSupply() → 100000000000000000000000000
balanceOf(A)  → 100000000000000000000000000
balanceOf(B)  → 0
```

构造函数把总量写入 A 的 Token 余额，并发出 `Transfer` 事件，发送方为零地址，接收方为 A。换成其他账户部署时，初始 Token 就属于那个账户。

### 2.2 部署 TokenBank 并绑定 T

1. 打开 `contracts/TokenBank.sol` 并编译。
2. 在 Deploy & Run 的合约选择框中选择 **TokenBank**。同文件的 `IERC20` 是接口，不能代替银行部署。
3. Account 保持 **A**，展开构造参数并填写：

```text
tokenAddress：T 的完整地址
```

4. 点击 Deploy，展开新生成的 TokenBank 实例，复制其地址作为 **K**。
5. 查询 `token()`，确认返回 T；在 `balances` 中填写 A 地址，应返回 0。再到 BaseERC20 查询 `balanceOf(K)`，也应为 0。

银行构造函数只绑定已有 Token，不会再次发行代币。部署者 A 也没有代提其他用户存款的特权。如果误填了别的 Token，银行部署后无法更换绑定地址，需要使用正确的 T 重新部署银行。

## 3. 账户 A 完成一次存款与提款

本节所有交易都由 **Account A** 发起，使用第 2 节的同一对 T、K。每笔交易确认成功后再进行下一步。

### 3.1 在 BaseERC20 上授权 10 枚

在 **BaseERC20 实例**中展开 `approve`，填写：

```text
spender：K 的完整地址
value：10000000000000000000
```

点击交易按钮。成功后，在同一实例的 `allowance` 中填写：

```text
owner：A 的完整地址
spender：K 的完整地址
```

预期返回 `10000000000000000000`。此时 `balanceOf(A)` 仍是一亿枚，`balanceOf(K)` 和银行的 `balances(A)` 仍为 0。

这一步只把 `allowances[A][K]` 设置为 10 枚，并发出 `Approval(A, K, 10 枚)` 事件，没有转账。再次 `approve` 会覆盖旧额度，不会累加；授权为 0 则撤销剩余额度。

### 3.2 在 TokenBank 上存入 10 枚

Account 保持 **A**，转到 **TokenBank 实例**，调用 `deposit`：

```text
amount：10000000000000000000
```

内部执行顺序是：

```text
A 调用 Bank.deposit(10 枚)
→ Bank 检查金额大于 0
→ Bank 调用 Token.transferFrom(A, K, 10 枚)
→ Token 的 _transfer 检查地址和 A 的余额，再将 10 枚从 A 转到 K
→ Token 检查 A 授权给 K 的额度并扣减；若不足，前面的转账和事件一并回滚
→ Bank 检查转账成功，将 balances[A] 增加 10 枚
```

在 Bank 中 `msg.sender` 是 A；进入 Token 后，`msg.sender` 变成 K。因此必须由 A 授权 K。`transferFrom` 已由银行自动调用，不需要自己额外点一次。

成功后查询：

```text
BaseERC20.balanceOf(A)    → 99999990000000000000000000（99,999,990 枚）
BaseERC20.balanceOf(K)    → 10000000000000000000（10 枚）
TokenBank.balances(A)     → 10000000000000000000（10 枚）
BaseERC20.allowance(A, K) → 0
```

交易包含 Token 的 `Transfer(A, K, amount)` 和银行的 `Deposited(A, amount)` 两条业务事件。余额与授权不足时，整笔存款回退，不会产生部分记账。

### 3.3 在 TokenBank 上提取 4 枚

Account 保持 **A**，调用 **TokenBank** 的 `withdraw`：

```text
amount：4000000000000000000
```

银行先检查 A 的可提余额，扣减 4 枚，再调用 Token 的 `transfer(A, 4 枚)`。这时 Token 的直接调用者是 K，因此扣的是银行自己持有的 Token。提款不需要 A 再次授权。

预期查询结果：

```text
BaseERC20.balanceOf(A) → 99999994000000000000000000（99,999,994 枚）
BaseERC20.balanceOf(K) → 6000000000000000000（6 枚）
TokenBank.balances(A)  → 6000000000000000000（6 枚）
```

成功交易包含 `Transfer(K, A, amount)` 和 `Withdrawn(A, amount)`。若转账回退或返回 false，银行此前扣减的个人余额也会回滚。

### 3.4 尝试提取 7 枚，验证超额限制

此时 A 只剩 6 枚存款，继续调用 **TokenBank** 的 `withdraw`：

```text
amount：7000000000000000000
```

应失败并显示：

```text
Insufficient deposited balance
```

重新查询上一步的三种余额，均应保持不变。这个失败是验证目标，不是需要修改合约才能继续的错误。

### 3.5 提取剩余 6 枚

仍由 A 调用 **TokenBank** 的 `withdraw`：

```text
amount：6000000000000000000
```

预期最终结果：

```text
BaseERC20.balanceOf(A) → 100000000000000000000000000（一亿枚）
BaseERC20.balanceOf(K) → 0
TokenBank.balances(A)  → 0
```

A 已完整取回自己的存款。`allowance(A, K)` 仍为 0，提款不会恢复之前消耗掉的授权额度；下一次存款前需要重新授权。

## 4. A、B 同时存款，验证个人余额隔离

从第 3 节完成后的状态继续，保持同一对 T、K。下面特意让两个人同时有存款，验证银行不能把总持币量当成某个人的可提余额。

### 4.1 A 先给 B 转 20 枚 Token

Account 选择 **A**，在 **BaseERC20** 的 `transfer` 中填写：

```text
to：B 的完整地址
value：20000000000000000000
```

成功后 B 持有 20 枚，A 持有 99,999,980 枚。银行仍为空。这里收款人是 B，不是 K；这是普通用户之间的 Token 转账。

### 4.2 B 授权并存入 10 枚

切换 Account 为 **B**，依次完成两笔交易：

```text
BaseERC20.approve
spender：K 的完整地址
value：10000000000000000000

TokenBank.deposit
amount：10000000000000000000
```

预期 B 钱包剩 10 枚，`balances(B)` 为 10 枚，`balances(A)` 为 0，银行实际持有 10 枚。只有 B 自己发起的 approve 才会设置 B 的额度；A 不能通过切换参数替 B 授权。

### 4.3 A 也授权并存入 6 枚

切换 Account 回 **A**，依次调用：

```text
BaseERC20.approve
spender：K 的完整地址
value：6000000000000000000

TokenBank.deposit
amount：6000000000000000000
```

查询结果应为：

```text
TokenBank.balances(A)  → 6000000000000000000（6 枚）
TokenBank.balances(B)  → 10000000000000000000（10 枚）
BaseERC20.balanceOf(K) → 16000000000000000000（16 枚）
```

### 4.4 A 不能从银行提取 7 枚

Account 保持 **A**，调用 `TokenBank.withdraw`，参数为：

```text
amount：7000000000000000000
```

即使银行总共持有 16 枚，A 也只能取自己的 6 枚。预期仍报 `Insufficient deposited balance`，A、B 的个人存款及银行实际持币量都不变。

### 4.5 两个人分别取回自己的余额

先由 **A** 调用 `TokenBank.withdraw`：

```text
amount：6000000000000000000
```

此时 `balances(A)` 为 0，`balances(B)` 仍为 10 枚，银行实际持有 10 枚。

再切换 Account 为 **B**，调用 `TokenBank.withdraw`：

```text
amount：10000000000000000000
```

最终状态：

```text
BaseERC20.balanceOf(A) → 99999980000000000000000000（99,999,980 枚）
BaseERC20.balanceOf(B) → 20000000000000000000（20 枚）
BaseERC20.balanceOf(K) → 0
TokenBank.balances(A)  → 0
TokenBank.balances(B)  → 0
```

A 和 B 的 Token 合计仍为一亿枚。账户的模拟 ETH 余额可能因 Gas 变化，不参与这份 Token 账目核对。

## 5. 异常检查与常见操作问题

以下检查从第 4 节结束后的状态开始；成功跑完主流程后再做，便于判断每次错误的原因。

### 5.1 有 Token 但没有授权

Account 选择 **A**。此时 A 有充足 Token，但 `allowance(A, K)` 为 0，直接调用银行的 `deposit`：

```text
amount：1000000000000000000
```

预期错误为 `ERC20: transfer amount exceeds allowance`。银行不记账，Token 不转移。要成功存款，需要先由 A 在 BaseERC20 上 `approve(K, amount)`，再调用 `deposit(amount)`。

### 5.2 授权足够，但 Token 余额不足

Account 切换为 **B**。B 当前只持有 20 枚，先授权 21 枚，再尝试存入 21 枚：

```text
BaseERC20.approve
spender：K 的完整地址
value：21000000000000000000

TokenBank.deposit
amount：21000000000000000000
```

预期错误为 `ERC20: transfer amount exceeds balance`。B 持币仍为 20 枚，银行存款仍为 0，授权仍为 21 枚，因为失败交易没有消耗额度。检查后可由 B 再调用 `approve(K, 0)` 清除这次测试授权。

### 5.3 零金额、空存款和无效地址

- 对银行调用 `deposit(0)` 或 `withdraw(0)`，应报 `Amount must be positive`。
- 第 4 节已经提空存款，因此由 A 或 B 调用 `withdraw(1000000000000000000)`，应报 `Insufficient deposited balance`。
- 新部署 TokenBank 时，把 `tokenAddress` 填成零地址或普通账户地址，应报 `Invalid token`。正确参数是已有 BaseERC20 实例的 T 地址。

### 5.4 直接把 Token 转到银行，为什么没有存款记录

`BaseERC20.transfer(K, amount)` 只改变 Token 的余额映射，不会调用 `TokenBank.deposit`，所以银行不会记录是谁应获得可提余额。本银行没有认领这类直接转账的功能，不能再用普通 `withdraw` 取回未记账部分。

正常存款始终使用 **approve → deposit**。直接转账不记账的行为已由自动化测试覆盖；若手动演示此场景，使用另一组模拟实例，以免影响主流程的余额核对。

### 5.5 切错账户、合约或环境时如何定位

- `approve`、`transfer`、`allowance`、`balanceOf` 在 **BaseERC20** 实例操作；`deposit`、`withdraw`、`balances`、`token` 在 **TokenBank** 实例操作。
- A 授权后用 B 调用存款，不会使用 A 的授权。先核对 Account，再核对 `balanceOf(当前账户)` 和 `allowance(当前账户, K)`。
- 重新部署银行会产生新的 K。之前对旧 K 的授权不会迁移，必须对新 K 授权。
- 顶部 Value 不为 0 时，本项目的非 payable 函数不能接收附带的 ETH；将 Value 恢复为 `0 Wei`。
- 本地源码修改后，需要同步到 Remix 并重新编译。已部署的旧实例仍执行旧代码；若要运行新代码，应部署新实例并记录新地址。
- 若关闭了实例面板，可在同一 VM 状态中，用匹配的源码编译结果及地址通过 **Add Contract / At Address** 重新加载。若 VM 状态已重置，旧地址不再对应原实例，需要从部署开始重新操作。[加载已部署实例](https://remix-ide.readthedocs.io/en/latest/run.html#loading-deployed-contracts)

## 6. 自动化测试与实际验证记录

在同一工作区执行以下步骤：

1. 确认第 1 节的 Solidity `0.8.24`、EVM `shanghai`、关闭优化配置已经设置。
2. 打开 Plugins，搜索并启用 **Solidity unit testing**。
3. 测试目录使用已有的 `tests`，勾选 `tests/TokenBank_test.sol`，点击 **Run**。
4. 等待结果，预期为 `Passed: 5`、`Failed: 0`。如果失败，展开对应测试检查错误原因。

`remix_tests.sol` 断言库由插件注入。插件在独立环境中运行测试，不会在手动部署面板中自动生成第 2 节的 T、K；测试与手动操作不要混用地址。[Remix 单元测试说明](https://remix-ide.readthedocs.io/en/latest/unittesting.html)

测试合约本身通过 `new BaseERC20()` 获得初始供应量，充当第一位用户；`TokenBankUser` 辅助合约充当第二位用户。每项测试重新创建 Token 和 Bank，验证重点如下：

1. `initialStateAndTokenRules`：发行信息、自转账、零转账、覆盖授权、消耗授权，以及转账失败时回滚。
2. `depositAndWithdraw`：存款累加、部分提款、全部提款，同时核对银行账本与实际 Token 余额。
3. `authorizationAndUserIsolation`：未授权、余额不足、超额提款，以及不同用户的余额隔离。
4. `invalidInputsAndDirectTransfer`：零金额、空余额提款、无效 Token 地址，以及直接转账不自动记账。
5. `failedTransfersRollBackAndCanRetry`：使用返回值替身模拟 Token 返回 false，验证存款不入账、提款回滚及恢复后的重试。真实代币的资产流由前面的测试负责验证。

**2026-09-10 已实际完成的运行记录：** Remix `2.5.7`，工作区 `tokenbank`，Solidity `0.8.24`，EVM `shanghai`，Optimization 关闭；编译成功，**Passed: 5，Failed: 0，Time Taken: 0.48 s**。该耗时是已有运行记录，再次执行时不要求耗时完全相同。

## 7. 交易结果、证据与作业提交

### 7.1 怎样确认每一步成功

交易发出后，在 Remix 终端展开该交易，核对成功状态、调用方、目标合约、输入参数和事件。仅看到交易条目不够，还应查询本步骤对应的余额或授权。

```text
授权成功：Approval 的 owner 为当前账户，spender 为 K，value 为设置的额度。
存款成功：Token 的 Transfer 从用户到 K；Bank 的 Deposited 记录同一用户和金额。
提款成功：Token 的 Transfer 从 K 到用户；Bank 的 Withdrawn 记录同一用户和金额。
失败调用：确认错误原因符合预期，再查询余额和授权，确认失败没有改变账目。
```

展开日志时注意发出事件的合约地址：`Transfer`、`Approval` 来自 T，`Deposited`、`Withdrawn` 来自 K。查询余额的只读调用不会产生新的业务事件。本代币的 `transferFrom` 消耗授权时也不会额外发出 `Approval`。

需要保存学习证据时，可按以下顺序截图，并在说明中标注 **Remix VM 模拟环境**：

1. 两个合约编译成功及编译器配置。
2. T、K 两个部署实例，以及 `TokenBank.token()` 返回 T。
3. 授权后 `allowance(A, K)` 为 10 枚。
4. A 存入 10 枚后，个人存款和银行持币量均为 10 枚。
5. A 提取 4 枚后剩 6 枚，以及提取 7 枚失败且余额不变。
6. A、B 同时存款时的各自余额，以及分别提款后的结果。
7. Solidity Unit Testing 的五项通过结果。

### 7.2 在题目中提交什么

- **ERC20 题目**：其答题区提供代码模板，按题面保留模板既有部分并补全对应位置。本项目把转账逻辑集中到 `_transfer`，可用来理解和对照实现；提交模板题时仍需遵守页面的格式要求。
- **TokenBank 题目**：可复制 `contracts/TokenBank.sol` 的完整内容，包含文件顶部的 `IERC20` 接口；也可以在答题框填写下方项目链接。`IERC20` 只是调用接口，实际使用时仍需先部署 BaseERC20，再把 T 传给银行。

项目提交链接：[GitHub · tokenbank](https://github.com/woyaofei303/block-chain-list/tree/main/tokenbank)

不需要把测试辅助合约部署为业务合约。Remix VM 的地址和交易属于浏览器模拟链，不能当作 Sepolia 或主网部署证据。图片额外提到了部署 ERC20，但未指定网络；当前已完成合约实现与 Remix 模拟测试，公共网络部署和网页答题提交尚未执行。

题目解析日期：2026-09-10。两个链接及其完整题目均已读取；本文手动流程中的查询值和错误信息按当前源码推导。

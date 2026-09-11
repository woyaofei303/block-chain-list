# TokenBankV2：Remix 完整交互流程

全程在 Remix VM 操作。以下手动步骤与数值为**新部署实例的复现步骤及预期结果**，实际自动化验证记录单列在第 7 节。操作顺序是：部署 → Hook 存款 → 提款 → 多用户 → 旧存款方式 → 异常验证。

## 1. 导入与编译

1. 打开 [Remix](https://remix.ethereum.org/)，当前入口也可使用 [app.remix.live](https://app.remix.live/)。创建空白工作区 `tokenbankv2`。
2. 在 Files 面板先选中根目录的 `remix.config.json`，再选择 **Create → Upload folders**，分别导入本项目的 `contracts` 和 `tests` 两个文件夹。每次导入前重新选中这个根目录文件，避免 Remix 把上传内容放进当前选中的子目录。不要把两个文件夹中的文件混放到根目录。
3. 也可以手动新建同名文件并复制源码。导入后的关键结构如下：

```text
contracts/BaseERC20.sol
contracts/ERC20WithCallback.sol
contracts/TokenBank.sol
contracts/TokenBankV2.sol
tests/HookHelpers.sol
tests/TokenBankV2_test.sol
```

4. Solidity Compiler 使用以下设置：

```text
Compiler：0.8.24+commit.e11b9ed9
Language：Solidity
Advanced Configurations → EVM Version：shanghai
Optimization：关闭
```

5. 分别打开并编译 `ERC20WithCallback.sol` 和 `TokenBankV2.sol`。相对路径会自动导入父合约；四个业务文件必须全部存在。

`remix_tests.sol` 由 Solidity Unit Testing 插件提供，不需要自行下载，不要把 Foundry 的 `forge-std/Test.sol` 加入项目。普通编译阶段先编译业务合约，测试文件交给插件运行。

## 2. 选择环境并部署

打开 Deploy & Run，选择 **Remix VM**。VM 若提供独立版本选择，可选 Shanghai 或支持 Shanghai 字节码的较新版本。保持顶部 **Value = 0 Wei**；Token 数量填写在函数参数中，不是顶部 Value。模拟 ETH 用于模拟 gas，与本项目的 BERC20 余额不同。[Remix 部署说明](https://remix-ide.readthedocs.io/en/latest/run.html)

先记下两个账户；部署后再记 Token 和银行地址：

```text
A：第一个 Remix VM 账户，Token 部署者
B：第二个 Remix VM 账户
T：ERC20WithCallback 实例地址
K：TokenBankV2 实例地址
```

A、B、T、K 只是本文代号。实际输入参数时，使用复制到的完整 `0x...` 地址，不能输入字母本身。

### 2.1 用 A 部署 ERC20WithCallback

1. Account 选择 A，打开并编译 `ERC20WithCallback.sol`。
2. Deploy & Run 的合约选择 **ERC20WithCallback**，不是 BaseERC20 或接口 ITokenReceiver。
3. 构造函数无参数，点击 Deploy，复制实例地址为 T。
4. 在 T 的实例中查询：

```text
name()        → BaseERC20
symbol()      → BERC20
decimals()    → 18
totalSupply() → 100000000000000000000000000
balanceOf(A)  → 100000000000000000000000000
balanceOf(B)  → 0
```

名称沿用父合约是正常的，是否部署正确请看实例名 **ERC20WithCallback** 和是否有 `transferWithCallback` 按钮。

### 2.2 部署 TokenBankV2 并绑定 T

1. 打开并编译 `TokenBankV2.sol`，合约选择 **TokenBankV2**。
2. 构造参数填写 Token 地址，然后 Deploy：

```text
tokenAddress：T 的完整地址
```

3. 复制银行地址为 K，核对：

```text
银行 K：token()     → T
银行 K：balances(A) → 0
银行 K：balances(B) → 0
代币 T：balanceOf(K) → 0
代币 T：allowance(A, K) → 0
```

银行不会增发 Token。绑定地址不可更改；地址填错时应重新部署银行。继承不是代理升级，V2 不会读取或迁移已有 TokenBank 的存款。

## 3. A 通过 Hook 存入 10 枚，再取回

所有数量均为整数最小单位：

```text
1 枚  = 1000000000000000000
2 枚  = 2000000000000000000
3 枚  = 3000000000000000000
4 枚  = 4000000000000000000
5 枚  = 5000000000000000000
6 枚  = 6000000000000000000
7 枚  = 7000000000000000000
10 枚 = 10000000000000000000
15 枚 = 15000000000000000000
20 枚 = 20000000000000000000
```

### 3.1 一笔交易完成存款

Account 选择 **A**，到 **Token T** 展开 `transferWithCallback`，填写后点击 transact：

```text
to：K 的完整地址
amount：10000000000000000000
```

这一条路径不需要先 approve，也不需要再点击银行的 deposit 或 tokensReceived。银行的回调会由 Token 自动调用。

```text
A → T.transferWithCallback(K, 10 枚)
    T 先把 10 枚从 A 转到 K
    T → K.tokensReceived(A, 10 枚)
        K 检查 msg.sender == T
        K 将 balances[A] 加 10 枚，并返回 true
```

查询以下结果，不能只看交易是否成功：

```text
T.balanceOf(A)    → 99999990000000000000000000（99,999,990 枚）
T.balanceOf(K)    → 10000000000000000000（银行真实持币 10 枚）
K.balances(A)     → 10000000000000000000（A 可提余额 10 枚）
K.balances(T)     → 0（不能把存款记到 Token 地址）
T.allowance(A, K) → 0（没有使用授权）
```

交易日志应包含 T 发出的 `Transfer(A, K, amount)` 和 K 发出的 `Deposited(A, amount)`。转账和记账属于同一笔交易。

### 3.2 A 提取 4 枚

Account 仍是 **A**，到 **银行 K** 调用 `withdraw`：

```text
amount：4000000000000000000
```

银行先扣个人存款，再调用普通 `T.transfer(A, amount)`。这时 Token 的调用者是 K，扣的是银行持币量；提款不触发 Hook。

```text
T.balanceOf(A) → 99999994000000000000000000（99,999,994 枚）
T.balanceOf(K) → 6000000000000000000
K.balances(A)  → 6000000000000000000
```

### 3.3 超额提款失败，再取出剩余 6 枚

仍用 A，在 K 调用：

```text
withdraw 的 amount：7000000000000000000
预期错误：Insufficient deposited balance
```

失败后查询 `K.balances(A)`、`T.balanceOf(K)`，均仍为 `6000000000000000000`。随后调用：

```text
withdraw 的 amount：6000000000000000000
```

成功后：

```text
K.balances(A)  → 0
T.balanceOf(K) → 0
T.balanceOf(A) → 100000000000000000000000000
```

## 4. A、B 两个用户各自存取

接着第 3 节的清空状态操作。

1. **A → Token T.transfer**，给 B 20 枚：

```text
to：B 的完整地址
value：20000000000000000000
```

2. **A → Token T.transferWithCallback**，向 K 存 10 枚：

```text
to：K 的完整地址
amount：10000000000000000000
```

3. 切到 **B → Token T.transferWithCallback**，向同一 K 存 5 枚：

```text
to：K 的完整地址
amount：5000000000000000000
```

4. 查询：

```text
K.balances(A)  → 10000000000000000000
K.balances(B)  → 5000000000000000000
T.balanceOf(K) → 15000000000000000000
T.balanceOf(B) → 15000000000000000000
```

5. **B → K.withdraw** 尝试提取 6 枚，预期 `Insufficient deposited balance`。银行总共有 15 枚，也不能拿别人的份额。
6. **A → K.withdraw**，`amount = 10000000000000000000`，A 余额清零，B 仍可提 5 枚。
7. **B → K.withdraw**，`amount = 5000000000000000000`，银行持币量及两人存款均归零，B 钱包恢复 20 枚。

账户 A、B 由顶部 Account 决定。`withdraw` 没有指定提款人的参数，只能提取当前调用者自己的余额。

## 5. 验证旧存款方式与 Hook 共用账本

接第 4 节的银行清空状态，切回 **A**：

1. 在 **T.approve** 授权 7 枚：

```text
spender：K 的完整地址
value：7000000000000000000
```

2. 在 **K.deposit** 存入 3 枚：

```text
amount：3000000000000000000
```

此时 `K.balances(A) = 3000000000000000000`，`T.allowance(A,K) = 4000000000000000000`。父合约用普通 `transferFrom` 转币，不会触发 Hook，所以只记一次账。

3. 在 **T.transferWithCallback** 再存入 2 枚：

```text
to：K 的完整地址
amount：2000000000000000000
```

```text
K.balances(A)     → 5000000000000000000
T.balanceOf(K)    → 5000000000000000000
T.allowance(A, K) → 4000000000000000000（Hook 未消耗授权）
```

4. **A → K.withdraw**，`amount = 5000000000000000000`，取回全部 5 枚。
5. **A → T.approve**，`spender = K`、`value = 0`，撤销剩余授权。提款本身不消耗这 4 枚授权。

## 6. 失败场景与普通转账对照

每次失败后都查询 Token 余额与银行账本，确认没有变化。Remix 若在估算 gas 时已报预期错误，说明模拟执行回退，不需要强制发送。

### 6.1 不能手动伪造回调

用 **A** 直接调用 **K.tokensReceived**：

```text
from：A 的完整地址
amount：10000000000000000000
预期错误：Only supported token
```

虽然 from 填了 A，调用者还是 A，不能冒充 Token。`from` 参数不是来源认证。

### 6.2 银行拒收另一种 Token

用 A 再部署一个 `ERC20WithCallback`，记为 **T2**。虽然代码相同，T2 与 T 是不同代币。在 **T2** 调用：

```text
transferWithCallback 的 to：K 的完整地址
transferWithCallback 的 amount：1000000000000000000
预期错误：Only supported token
```

T2 的转账一并回滚：`T2.balanceOf(K) = 0`，A 的 T2 余额还是全部发行量，K 的账本不增加。K 只认部署时绑定的 T。

### 6.3 接收方没有 Hook

单独部署原版 **TokenBank**，`tokenAddress = T`，记为 **K1**。用 A 在 **T.transferWithCallback** 向 K1 转 1 枚，预期回退，因为 K1 没有 `tokensReceived`。此场景错误文本可能因 Remix 显示而不同；核对失败状态、A 余额未减、`T.balanceOf(K1) = 0`。

接收方显式返回 false 和主动 revert 的场景由第 7 节的 `HookReceiver` 自动测试覆盖。

### 6.4 零金额、零地址和余额不足

```text
T.transferWithCallback(K, 0) → Amount must be positive
K.deposit(0)               → Amount must be positive
K.withdraw(0)              → Amount must be positive

T.transferWithCallback(0x0000000000000000000000000000000000000000, 1)
→ ERC20: transfer to the zero address

T.transferWithCallback(K, 100000000000000000000000001)
→ ERC20: transfer amount exceeds balance
```

银行不接受零金额存款，但 Token 向普通无代码地址进行零金额转账仍然允许。

### 6.5 普通 transfer 不会自动存款

使用第 6.3 节的 K1 或另部署一个空 **TokenBankV2** 作为对照银行，避免改变主流程的余额。用 A 在 T 的普通 `transfer` 向对照银行转 1 枚：

```text
to：对照银行的完整地址
value：1000000000000000000
```

```text
T.balanceOf(对照银行) → 1000000000000000000
对照银行.balances(A) → 0
A 调用对照银行.withdraw(1000000000000000000)
→ Insufficient deposited balance
```

这个对照说明“银行持有币”和“银行记了个人存款”是两回事。该笔误转没有提款或找回入口；正式练习存款时使用 Hook 或 `approve + deposit`。

## 7. 自动化测试与验证记录

1. 启用 Plugins 中的 **Solidity Unit Testing**（已启用时直接打开左侧图标）。
2. 先在编译器成功编译业务合约，确保 Solidity 0.8.24 已加载。
3. Test directory 选择 `tests`，勾选 `tests/TokenBankV2_test.sol`，点击 **Run**。不要点击 Generate 覆盖现有测试。
4. 预期六组测试通过，`Passed: 6`、`Failed: 0`；展开失败项可查看错误。

测试合约自己部署 Token 和 Bank。Token 初始持有人是测试合约，`HookBankUser` 模拟另一位用户，因此能验证合约账户存款不会错误地记到 `tx.origin`。每组测试重新部署，独立于手动面板中的 T、K。[Remix 测试说明](https://remix-ide.readthedocs.io/en/latest/unittesting.html)

测试中的 `10 ether` 只是 Solidity 表达式 `10 * 10 ** 18` 的简写，作为 Token 数量传入；没有发送 10 ETH。测试不要求安装 npm、Foundry 或连接钱包。

**2026-09-11 实际验证记录：** Remix `2.5.7`，工作区 `tokenbankv2`，Solidity `0.8.24+commit.e11b9ed9`，EVM `shanghai`，Optimization 关闭；六组测试全部通过，**Passed: 6，Failed: 0，Time Taken: 0.56 s**。耗时仅记录本次运行，再次执行不要求相同。

开发中先用仅普通转账、没有 Hook 记账的实现运行第一条存取款测试，结果 `Passed: 0，Failed: 1`；补上 Hook 后同一条测试通过，再扩展到六组。上面手动面板的逐笔操作仍是供学习者复现的预期流程，不应当作已执行的独立交易记录。本次未部署到公共网络、未提交答题表单。

## 8. 排错与保存

- 没有 `transferWithCallback`：确认部署的是 ERC20WithCallback，且编译后部署了新实例。
- `Only supported token`：核对 `K.token()`，应与调用的 T 完全一致；不要手动点击 tokensReceived。
- `ERC20: transfer amount exceeds allowance`：当前调用的是旧 `deposit` 路径，应先授权 K；Hook 路径不需要 approve。
- Token 余额够却无法提款：检查 `K.balances(当前 Account)`，再检查是否用普通 transfer 误转。
- 导入报找不到文件：恢复 `contracts`、`tests` 的相对目录结构，尤其是两个父合约和 HookHelpers。
- 源码更新后旧实例行为没变：重新编译、部署，记录新 T 和 K；源码不会更新已部署的代码。
- 测试 Run 灰色：先编译业务合约，让编译器完成加载，并检查测试目录与勾选状态。
- VM 被重置：旧地址与状态已失效，从部署重新开始，不能套用旧地址和余额。

复习时可保存部署地址、Hook 存款的 Transfer 与 Deposited 事件、提款前后两种余额，以及六组测试通过的截图。Remix VM 是浏览器模拟链，其地址不能作为 Sepolia 或主网部署证明。

# Bank 与 TokenBank 测试完整说明

本项目使用 Foundry 验证两个独立场景：Bank 的 ETH 存款、前三名和管理员提款，以及 TokenBank 在 Sepolia fork 中对 USDT 测试 Token 的存取。

项目不依赖 `forge-std`。测试文件只声明实际使用的 Foundry cheatcode，因此克隆目录后不需要下载 Solidity 测试库。

## 1. 项目结构与阅读顺序

```text
bank-tokenbank-tests-10/
├── foundry.toml
├── src/
│   ├── Bank.sol
│   └── TokenBank.sol
├── script/
│   ├── DeployBank.s.sol
│   └── DeployTokenBank.s.sol
├── test/
│   ├── Bank.t.sol
│   └── TokenBankUSDTSepoliaFork.t.sol
├── test-results/
│   └── forge-test.log
└── README.md
```

建议按下面的顺序阅读：

1. `src/Bank.sol`：理解 ETH 如何进入 Bank、如何累计存款和更新前三名。
2. `test/Bank.t.sol`：查看每条 Bank 需求如何转换成可运行断言。
3. `src/TokenBank.sol`：理解 ERC-20 的授权、存款和提款。
4. `test/TokenBankUSDTSepoliaFork.t.sol`：理解 Sepolia fork 如何复用链上 USDT 状态。
5. `script/`：模拟或广播两个合约的 Sepolia 部署。
6. `test-results/forge-test.log`：核对最后一次完整运行结果。

## 2. 运行测试前需要理解的四个概念

### 2.1 `msg.sender` 与 `vm.prank`

合约用 `msg.sender` 判断是谁在操作。测试中的 `vm.prank(ALICE)` 只会让紧接着的一次普通外部调用看起来由 Alice 发起。

因此测试可以在不创建私钥、不签名交易的情况下，模拟 Alice、Bob、Carol 和 Dave 四个独立用户。

### 2.2 ETH 与 Wei

Solidity 中 ETH 数量最终以 Wei 表示。测试里的 `2 ether` 是 Solidity 提供的单位写法，等于 `2 * 10^18 Wei`。

`vm.deal(ALICE, 10 ether)` 只给本地测试地址设置余额，不会领取或消耗真实测试币。

### 2.3 ERC-20 授权

TokenBank 不能直接拿走用户的 Token。用户必须先调用 USDT 的 `approve(TokenBank, amount)`，再调用 TokenBank 的 `deposit(amount)`。

授权只设置额度，不会转币。真正的转币发生在 TokenBank 调用 USDT `transferFrom` 时。

### 2.4 Sepolia fork

fork 会通过 RPC 读取某个 Sepolia 区块的合约代码和状态，再在本机创建临时副本。后续操作只修改本地副本，不会广播交易。

这既能调用真实部署过的 USDT 合约，又不需要私钥、Sepolia ETH 或真实链上交易。

## 3. Bank 合约整体流程

Bank 接收原生 ETH，记录每位用户的历史累计存款，并维护累计存款金额最高的三个地址。

```text
用户发送 ETH
    ↓
deposit() 或 receive()
    ↓
deposits[用户] += msg.value
    ↓
_updateTop3(用户)
    ↓
Bank 实际 ETH 余额增加
```

### 3.1 状态变量

- `admin`：部署 Bank 的地址。使用 `immutable`，部署后不能修改。
- `deposits[user]`：用户历史累计存入的 ETH，管理员提款后也不会清零。
- `top3[0..2]`：累计存款前三名，按金额从高到低排列。

`deposits` 是历史数据，`address(bank).balance` 是 Bank 当前实际持有的 ETH。管理员提款后，前者保留，后者变为零。

### 3.2 两种存款入口

用户显式调用 `deposit()` 时，Bank 读取本次交易的 `msg.value` 并记账。

用户直接向 Bank 地址转 ETH 且不带调用数据时，会进入 `receive()`。`receive()` 再调用 `deposit()`，两种入口最终共用同一套逻辑。

存款金额必须大于零。记账顺序如下：

1. 检查 `msg.value > 0`。
2. 把本次金额加到 `deposits[msg.sender]`。
3. 使用更新后的累计金额调整 `top3`。

### 3.3 前三名算法

每次存款时，只有当前存款人的金额发生变化。算法不需要遍历所有历史用户，只需要检查这个地址和三个榜位。

第一步，算法在 `top3` 中寻找当前用户：

- 找到：从原位置开始向前比较。
- 未找到：`index` 最终为 `3`，表示当前用户在榜外。

第二步，如果用户在榜外，就把他的累计金额与第三名比较：

- 严格大于第三名：先进入第三位，再继续尝试向前移动。
- 小于或等于第三名：排名不变，函数直接结束。

第三步，用户从当前位置向前比较。只要他的累计金额严格大于前一名，就把前一名后移，再把当前用户前移。

比较使用 `>` 而不是 `>=`。因此金额相同时保留原有先后顺序，榜外用户也不会用相同金额挤掉当前第三名。

### 3.4 管理员提款

`withdraw()` 先检查 `msg.sender == admin`。非管理员调用会以 `Only admin` 回滚，Bank 余额不会改变。

管理员调用时，Bank 使用 `call` 把当前全部 ETH 发送给管理员。如果发送失败，`require` 会让整次提款回滚。

## 4. Bank 测试如何覆盖需求

Foundry 在每个 `test*` 函数前重新执行 `setUp()`。每项测试都会部署一个新的 Bank，并给四个模拟用户各准备 `10 ETH`。

由于 Bank 由 `BankTest` 部署，所以 Bank 的管理员是测试合约本身。测试合约实现了 `receive()`，可以接收管理员提款转出的 ETH。

### 4.1 存款前后记账

`testDepositUpdatesUserBalance` 执行以下步骤：

1. 读取 Alice 存款前的 `deposits(ALICE)`，预期为 `0`。
2. 用 Alice 身份存入 `2 ETH`。
3. 断言新值等于旧值加 `2 ETH`。

### 4.2 一个用户

`testTop3WithOneUser` 让 Alice 存入 `1 ETH`，预期排名为：

```text
[Alice, address(0), address(0)]
```

### 4.3 两个用户

`testTop3WithTwoUsers` 让 Alice 存 `1 ETH`、Bob 存 `2 ETH`，预期排名为：

```text
[Bob, Alice, address(0)]
```

### 4.4 三个用户

`testTop3WithThreeUsers` 使用 `1、3、2 ETH` 三个金额，预期排名为：

```text
[Bob, Carol, Alice]
```

### 4.5 四个用户

`testTop3WithFourUsers` 使用以下存款：

```text
Alice = 1 ETH
Bob   = 4 ETH
Carol = 2 ETH
Dave  = 3 ETH
```

排行榜只能保留三人，所以 Alice 被挤出，预期结果为：

```text
[Bob, Dave, Carol]
```

### 4.6 同一用户多次存款

`testTop3UsesSameUsersCumulativeDeposits` 先让 Alice 存 `1 ETH`，再让其他用户进入排行榜，最后让 Alice 再存 `4 ETH`。

Alice 的累计存款变为 `5 ETH`。测试同时断言累计值正确，且 Alice 只占一个榜位：

```text
[Alice(5), Bob(4), Carol(3)]
```

### 4.7 只有管理员可以提款

`testOnlyAdminCanWithdraw` 先让 Alice 存入 `3 ETH`，再分两步验证权限：

1. Bob 调用 `withdraw()`，预期以 `Only admin` 回滚，Bank 仍有 `3 ETH`。
2. 管理员调用 `withdraw()`，Bank 余额变为零，管理员余额增加 `3 ETH`。

## 5. TokenBank 合约整体流程

TokenBank 管理 ERC-20 Token，不接收原生 ETH。部署时传入 Token 地址，之后所有用户都存取这个 Token。

`balances[user]` 表示用户当前可以取出的 Token 数量，计算方式是累计存入减去累计取出。

这与 Bank 的 `deposits[user]` 不同：Bank 保存历史累计存款，而 TokenBank 在提款时会减少 `balances[user]`。

### 5.1 存款流程

```text
Alice → USDT.approve(TokenBank, amount)
Alice → TokenBank.deposit(amount)
TokenBank → USDT.transferFrom(Alice, TokenBank, amount)
TokenBank → balances[Alice] += amount
```

具体顺序如下：

1. Alice 在 USDT 合约中授权 TokenBank。
2. Alice 调用 TokenBank 的 `deposit(amount)`。
3. TokenBank 检查金额大于零。
4. TokenBank 调用 USDT `transferFrom`，把 Token 从 Alice 转到自己。
5. 转币成功后，TokenBank 增加 Alice 的内部余额。

先转币、后记账可以避免转币失败时产生没有真实资产支持的内部余额。

### 5.2 提款流程

```text
Alice → TokenBank.withdraw(amount)
TokenBank → 检查 balances[Alice]
TokenBank → balances[Alice] -= amount
TokenBank → USDT.transfer(Alice, amount)
```

提款先检查金额和用户余额，再扣内部账，最后调用 USDT 转账。如果 USDT 转账失败，`require` 会让整笔交易回滚，内部扣账也会恢复。

## 6. Sepolia USDT fork 测试流程

测试使用 Aave V3 Sepolia 地址簿登记的 USDT 测试 Token。它是 Sepolia 测试资产，不是以太坊主网上具有实际价值的 USDT。

```text
网络：Sepolia
Chain ID：11155111
固定区块：11706800
USDT：0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0
Decimals：6
```

- [Aave V3 Sepolia 地址簿](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Sepolia.sol)
- [Sepolia Etherscan](https://sepolia.etherscan.io/token/0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0)

### 6.1 为什么固定区块

链上余额会随交易变化。固定区块可以让 USDT 合约代码、持币账户余额和测试输入保持一致，使其他人运行时得到相同前置状态。

### 6.2 `setUp()` 做了什么

每次测试开始前依次执行：

1. 读取 `SEPOLIA_RPC_URL`；未配置时使用项目内的公开 RPC。
2. 在区块 `11706800` 创建 Sepolia fork。
3. 检查 chain ID，防止误连主网或其他测试网。
4. 检查 Token 的 `symbol` 为 `USDT`、`decimals` 为 `6`。
5. 部署一个绑定该 USDT 地址的全新 TokenBank。
6. 在本地 fork 中模拟持币地址，给 Alice 转入 `1,000 USDT`。

持币地址模拟只发生在本地 fork。测试没有该地址的私钥，也不会控制或修改真实链上的资产。

### 6.3 为什么 `1_000e6` 是 1,000 USDT

该 USDT 使用 6 位小数。链上数量以最小单位表示：

```text
1 USDT     = 1 * 10^6
1,000 USDT = 1,000 * 10^6 = 1_000e6
```

### 6.4 完整存取断言

`testSepoliaUSDTDepositAndWithdraw` 按真实交互顺序执行：

1. 确认 Alice 初始拥有 `1,000 USDT`。
2. Alice 授权 TokenBank 使用 `1,000 USDT`。
3. Alice 存入全部 `1,000 USDT`。
4. 检查 `balances(ALICE) == 1,000 USDT`。
5. 检查 TokenBank 的真实 USDT 持仓也是 `1,000 USDT`。
6. Alice 取出 `400 USDT`，检查内部余额剩 `600 USDT`。
7. Alice 再取出 `600 USDT`。
8. 检查 Alice 恢复 `1,000 USDT`，TokenBank 内部余额和持仓都归零。

同时检查内部记账和 Token 实际余额，可以避免只更新 mapping、但没有真实转币的错误测试通过。

## 7. 如何运行

先确认已安装 Foundry：

```bash
forge --version
```

进入项目并运行完整测试：

```bash
cd bank-tokenbank-tests-10
forge test -vv
```

项目默认使用公开 Sepolia RPC。公开服务可能限流，也可以使用自己的 Sepolia RPC：

```bash
SEPOLIA_RPC_URL=https://your-sepolia-rpc.example forge test -vv
```

只运行 Bank 测试：

```bash
forge test --match-contract BankTest -vv
```

只运行 Sepolia USDT fork 测试：

```bash
forge test --match-contract TokenBankUSDTSepoliaForkTest -vv
```

检查 Solidity 格式：

```bash
forge fmt --check
```

## 8. 如何判断结果通过

完整运行应该看到两个测试套件：

```text
BankTest：7 passed
TokenBankUSDTSepoliaForkTest：1 passed
合计：8 passed, 0 failed, 0 skipped
```

仓库保存了最后一次完整运行输出：[`test-results/forge-test.log`](test-results/forge-test.log)。日志用于提交证据，重新运行时耗时和 Gas 显示可能略有不同。

## 9. 作业要求与文件对应关系

- 存款前后记账：`testDepositUpdatesUserBalance`。
- 1 个用户前三名：`testTop3WithOneUser`。
- 2 个用户前三名：`testTop3WithTwoUsers`。
- 3 个用户前三名：`testTop3WithThreeUsers`。
- 4 个用户前三名：`testTop3WithFourUsers`。
- 同一用户多次存款：`testTop3UsesSameUsersCumulativeDeposits`。
- 只有管理员提款：`testOnlyAdminCanWithdraw`。
- Sepolia USDT 存取：`testSepoliaUSDTDepositAndWithdraw`。
- 测试通过日志：`test-results/forge-test.log`。

## 10. Sepolia 部署与查看

`script/DeployBank.s.sol` 部署 Bank，部署交易的发送者会成为 `admin`。

`script/DeployTokenBank.s.sol` 部署 TokenBank，并自动绑定本项目测试使用的 Sepolia USDT 地址。

Foundry 脚本默认只模拟。只有增加 `--broadcast` 并提供签名账户后，交易才会发送到 Sepolia。

### 10.1 准备 RPC 与部署账户

设置公开信息，不要把私钥直接写入命令或提交到仓库：

```bash
export SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
export DEPLOYER_ADDRESS="0x你的部署账户地址"
```

把私钥交互式导入 Foundry 加密 keystore。终端会隐藏私钥和密码输入：

```bash
cast wallet import sepolia-deployer --interactive
```

部署账户需要少量 Sepolia ETH 支付 Gas。先检查余额：

```bash
cast balance "$DEPLOYER_ADDRESS" --ether --rpc-url "$SEPOLIA_RPC_URL"
```

### 10.2 先模拟 Bank 部署

下面的命令会连接 Sepolia 读取链状态并完整模拟，但不会发送交易：

```bash
forge script script/DeployBank.s.sol:DeployBankScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --sender "$DEPLOYER_ADDRESS" \
  -vvvv
```

输出中的 `BankDeployed` 和 `== Return ==` 会显示模拟部署地址与管理员地址。最后还会显示预计 Gas 和预计需要的 Sepolia ETH。

### 10.3 广播 Bank 部署

确认模拟结果和 Gas 后，再增加账户与 `--broadcast`：

```bash
forge script script/DeployBank.s.sol:DeployBankScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --sender "$DEPLOYER_ADDRESS" \
  --account sepolia-deployer \
  --broadcast \
  -vvvv
```

命令会要求输入 keystore 密码。成功后，真实部署地址会保存在 `broadcast/DeployBank.s.sol/11155111/run-latest.json`。

可以直接提取地址：

```bash
export BANK_ADDRESS="$(jq -r '.transactions[] | select(.transactionType == "CREATE") | .contractAddress' broadcast/DeployBank.s.sol/11155111/run-latest.json)"
printf '%s\n' "$BANK_ADDRESS"
printf 'https://sepolia.etherscan.io/address/%s\n' "$BANK_ADDRESS"
```

最后一行生成浏览器链接。只有广播成功后的真实地址能在 Sepolia Etherscan 中查看，模拟地址不会出现在链上。

### 10.4 查看 Bank

先确认地址上存在合约代码，再读取管理员、余额和排行榜：

```bash
cast code "$BANK_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
cast call "$BANK_ADDRESS" 'admin()(address)' --rpc-url "$SEPOLIA_RPC_URL"
cast balance "$BANK_ADDRESS" --ether --rpc-url "$SEPOLIA_RPC_URL"
cast call "$BANK_ADDRESS" 'top3(uint256)(address)' 0 --rpc-url "$SEPOLIA_RPC_URL"
cast call "$BANK_ADDRESS" 'top3(uint256)(address)' 1 --rpc-url "$SEPOLIA_RPC_URL"
cast call "$BANK_ADDRESS" 'top3(uint256)(address)' 2 --rpc-url "$SEPOLIA_RPC_URL"
```

查询某个用户的历史累计存款：

```bash
export USER_ADDRESS="0x要查询的用户地址"
cast call "$BANK_ADDRESS" 'deposits(address)(uint256)' "$USER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
```

### 10.5 向 Bank 存款并查看结果

下面示例让 keystore 中的部署账户存入 `0.001 Sepolia ETH`：

```bash
cast send "$BANK_ADDRESS" 'deposit()' \
  --value 0.001ether \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --account sepolia-deployer
```

交易确认后，再读取该账户累计存款和 Bank 实际余额：

```bash
cast call "$BANK_ADDRESS" 'deposits(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
cast balance "$BANK_ADDRESS" --ether --rpc-url "$SEPOLIA_RPC_URL"
```

只有 `admin()` 返回的账户可以提款。提款会取走 Bank 的全部 ETH：

```bash
cast send "$BANK_ADDRESS" 'withdraw()' \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --account sepolia-deployer
```

### 10.6 模拟并广播 TokenBank 部署

先模拟：

```bash
forge script script/DeployTokenBank.s.sol:DeployTokenBankScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --sender "$DEPLOYER_ADDRESS" \
  -vvvv
```

确认模拟结果后广播：

```bash
forge script script/DeployTokenBank.s.sol:DeployTokenBankScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --sender "$DEPLOYER_ADDRESS" \
  --account sepolia-deployer \
  --broadcast \
  -vvvv
```

提取真实 TokenBank 地址，并保存 Sepolia USDT 地址：

```bash
export TOKEN_BANK_ADDRESS="$(jq -r '.transactions[] | select(.transactionType == "CREATE") | .contractAddress' broadcast/DeployTokenBank.s.sol/11155111/run-latest.json)"
export USDT_ADDRESS="0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0"
printf '%s\n' "$TOKEN_BANK_ADDRESS"
printf 'https://sepolia.etherscan.io/address/%s\n' "$TOKEN_BANK_ADDRESS"
```

### 10.7 查看 TokenBank

核对合约代码、绑定的 Token，以及指定用户的可提余额：

```bash
cast code "$TOKEN_BANK_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
cast call "$TOKEN_BANK_ADDRESS" 'token()(address)' --rpc-url "$SEPOLIA_RPC_URL"
cast call "$TOKEN_BANK_ADDRESS" 'balances(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
cast call "$USDT_ADDRESS" 'balanceOf(address)(uint256)' "$TOKEN_BANK_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
```

### 10.8 使用 Sepolia USDT 存取

真实交互要求部署账户已经持有该 Sepolia USDT 测试 Token。先读取钱包余额：

```bash
cast call "$USDT_ADDRESS" 'balanceOf(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
```

该 USDT 使用 6 位小数。下面以 `1 USDT = 1000000` 最小单位为例，先授权，再存入：

```bash
cast send "$USDT_ADDRESS" 'approve(address,uint256)(bool)' "$TOKEN_BANK_ADDRESS" 1000000 \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --account sepolia-deployer

cast send "$TOKEN_BANK_ADDRESS" 'deposit(uint256)' 1000000 \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --account sepolia-deployer
```

查看内部记账与 TokenBank 的实际 USDT 持仓：

```bash
cast call "$TOKEN_BANK_ADDRESS" 'balances(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
cast call "$USDT_ADDRESS" 'balanceOf(address)(uint256)' "$TOKEN_BANK_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
```

取出 `1 USDT`，再检查用户余额和 TokenBank 余额：

```bash
cast send "$TOKEN_BANK_ADDRESS" 'withdraw(uint256)' 1000000 \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --account sepolia-deployer

cast call "$TOKEN_BANK_ADDRESS" 'balances(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
cast call "$USDT_ADDRESS" 'balanceOf(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
```

### 10.9 部署结果保存在哪里

Foundry 会为每个已广播脚本保存交易与回执：

```text
broadcast/DeployBank.s.sol/11155111/run-latest.json
broadcast/DeployTokenBank.s.sol/11155111/run-latest.json
```

`broadcast/` 和 `cache/` 可能包含部署账户、交易参数及本地签名信息，已经通过 `.gitignore` 排除，不会提交到仓库。

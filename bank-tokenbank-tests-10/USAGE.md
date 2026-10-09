# Bank / TokenBank 公共测试网操作参考

先完成 [README](README.md) 的本地测试和 fork 学习，再使用本篇。贯穿例子是 Alice 授权并存入 1,000 USDT，再取 400 和 600；USDT 的最小单位数为枚数乘 `10^6`。

下方保留部署、读取与存取命令。`cast call` 是只读/模拟；`cast send` 和 `--broadcast` 会真实写入 Sepolia，和 fork 测试完全不同。需要本人控制的钱包、测试资产、网络与费用确认；不要把测试中的 `vm.prank` 当成真实账户权限。

本次文档重构没有执行下列公共链步骤。部署脚本中 Token 地址固定为本项目的 Sepolia 测试 USDT，直接对空白 Anvil 运行该脚本会因为地址没有代码而失败。

所有命令在项目目录执行。从仓库根目录进入一次，并保持同一终端，以保留后续变量：

```bash
cd bank-tokenbank-tests-10
```

## 1. Sepolia 部署与查看

`script/DeployBank.s.sol` 部署 Bank，部署交易的发送者会成为 `admin`。

`script/DeployTokenBank.s.sol` 部署 TokenBank，并自动绑定本项目测试使用的 Sepolia USDT 地址。

Foundry 脚本默认只模拟。只有增加 `--broadcast` 并提供签名账户后，交易才会发送到 Sepolia。

### 1.1 准备 RPC 与部署账户

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

### 1.2 先模拟 Bank 部署

下面的命令会连接 Sepolia 读取链状态并完整模拟，但不会发送交易：

```bash
forge script script/DeployBank.s.sol:DeployBankScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --sender "$DEPLOYER_ADDRESS" \
  -vvvv
```

输出中的 `BankDeployed` 和 `== Return ==` 会显示模拟部署地址与管理员地址。最后还会显示预计 Gas 和预计需要的 Sepolia ETH。

### 1.3 广播 Bank 部署

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

### 1.4 查看 Bank

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

### 1.5 向 Bank 存款并查看结果

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

### 1.6 模拟并广播 TokenBank 部署

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

### 1.7 查看 TokenBank

核对合约代码、绑定的 Token，以及指定用户的可提余额：

```bash
cast code "$TOKEN_BANK_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
cast call "$TOKEN_BANK_ADDRESS" 'token()(address)' --rpc-url "$SEPOLIA_RPC_URL"
cast call "$TOKEN_BANK_ADDRESS" 'balances(address)(uint256)' "$DEPLOYER_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
cast call "$USDT_ADDRESS" 'balanceOf(address)(uint256)' "$TOKEN_BANK_ADDRESS" --rpc-url "$SEPOLIA_RPC_URL"
```

### 1.8 使用 Sepolia USDT 存取

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

### 1.9 部署结果保存在哪里

Foundry 会为每个已广播脚本保存交易与回执：

```text
broadcast/DeployBank.s.sol/11155111/run-latest.json
broadcast/DeployTokenBank.s.sol/11155111/run-latest.json
```

`broadcast/` 和 `cache/` 可能包含部署账户、交易参数及本地签名信息，已经通过 `.gitignore` 排除，不会提交到仓库。

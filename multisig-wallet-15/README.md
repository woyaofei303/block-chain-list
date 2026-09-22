# 简单多签合约钱包

本项目根据本次练习题实现四项功能：部署时确定持有人和签名门槛，持有人提交提案，其他持有人通过交易确认，达到门槛后任何人都能执行。使用 Solidity `0.8.24` 和 Foundry，不依赖第三方合约库。

## 代码阅读顺序

1. [项目规则](AGENTS.md)：本地验证与执行边界。
2. [MultiSigWallet.sol](src/MultiSigWallet.sol)：按构造函数、提交、确认、执行的顺序阅读。
3. [MultiSigWallet.t.sol](test/MultiSigWallet.t.sol)：从 ETH 转账完整流程开始，再看权限、失败重试和重入检查。
4. [foundry.toml](foundry.toml)：编译器、EVM 和本地产物目录。

## 合约流程

以 Alice、Bob、Carol 三位持有人、门槛为 2 为例：

```text
部署：owners = [Alice, Bob, Carol]，required = 2
充值：任意账户向钱包地址转入 ETH
Alice 提交：submitTransaction(收款地址, Wei 金额, calldata)
    → 返回提案编号 txId，初始确认数为 0
Bob 确认：confirmTransaction(txId)
    → 确认数为 1，仍不能执行
Carol 确认：confirmTransaction(txId)
    → 确认数为 2，允许执行
任意账户执行：executeTransaction(txId)
    → 钱包向指定地址发送 ETH，并执行指定 calldata
    → 执行成功后，同一提案不能再次执行
```

题面没有规定以下细节，本项目作出这些实现选择：

- 持有人和门槛部署后固定。持有人不能为空、不能包含零地址或重复地址；门槛范围为 `1..持有人人数`。
- 提交提案不自动确认。提案人也可以显式确认，每个持有人对同一提案最多计一票；提交、确认、执行是独立交易。
- 提案编号从 `0` 连续递增，每份提案独立计票。目标地址不能为零，目标、金额、calldata 提交后不可修改。
- `value` 是钱包将支付的 ETH 数量，单位为 Wei。普通转账的 `data` 为 `0x`；调用其他合约时填写对应 ABI 编码数据，可以同时附带 ETH。
- 提交和确认时无需足额余额，执行时才检查。执行者支付本次执行交易的 Gas，提案的 ETH 从钱包余额支付。
- 执行先标记 `executed = true`，再进行外部调用，阻止同一提案在回调中重复执行。余额不足或外部调用回滚时，整笔执行回滚，确认票数保留，条件恢复后可重试。

## 对外接口

写入接口：

```solidity
constructor(address[] memory initialOwners, uint256 requiredConfirmations)
submitTransaction(address to, uint256 value, bytes calldata data) returns (uint256 txId)
confirmTransaction(uint256 txId)
executeTransaction(uint256 txId)
```

查询接口：

```text
getOwners()                    全部持有人
owners(index)                  指定下标的持有人
isOwner(address)               是否为持有人
required()                     确认门槛
getTransactionCount()          提案总数
transactions(txId)             to、value、data、executed、numConfirmations
isConfirmed(txId, owner)       该持有人是否已确认该提案
```

钱包通过 `receive()` 接收 calldata 为空的 ETH 转账。充值、提交、确认、成功执行分别发出 `Deposit`、`SubmitTransaction`、`ConfirmTransaction`、`ExecuteTransaction` 事件；提交交易的回执可从事件中获取 `txId`。

## 本地验证

单元测试只需已安装 Foundry，不需要 npm、`forge install`、RPC、环境变量或钱包私钥。以下命令从**仓库根目录**执行：

```bash
forge --version
forge fmt --root multisig-wallet-15 --check
forge build --root multisig-wallet-15
forge test --root multisig-wallet-15 -vv
```

若需要查看完整 ETH 转账调用链，从**仓库根目录**执行：

```bash
forge test --root multisig-wallet-15 --match-test testEthTransferPermissionsThresholdAndReplay -vvvv
```

配置固定为 Solidity `0.8.24`、EVM `shanghai`、关闭优化。首次编译可能下载指定版本的编译器。编译与测试产物写入仓库的 `output-tdd/multisig-wallet-15/`，不提交。

测试使用 Forge 本地 EVM，模拟不同调用者，不需要运行 Anvil，也不会发送公共链交易。检查覆盖：

- 持有人与门槛的合法性，以及部署者不会自动获得持有人权限。
- ETH 充值、提案数据保存、提交与确认权限、门槛不足和重复确认。
- 非持有人执行、已执行提案不可再次确认或执行。
- 多份提案独立计票、超过门槛仍能执行、零金额调用。
- 合约调用的 calldata、ETH 金额与调用者身份。
- 目标回滚和余额不足后的状态、资金保留及重试。
- 同一提案的重入攻击，以及 `1/1`、`3/3` 门槛边界。

## 命令行完整流程：本地部署到执行

使用 Anvil、Forge、Cast 和 `jq`。本节在独立本地链上完成三人两票钱包的部署、充值、提交、确认和执行，使用节点内置的模拟账户，无需私钥。所有 `--unlocked` 命令仅用于本地 Anvil。

### 1. 终端一：启动本地链

可在任意目录执行。先确认端口没有被其他服务占用；`lsof` 无输出表示没有监听进程。若被占用，请换端口并同步下一步的 RPC 地址，不要停止不明进程。

```bash
lsof -nP -iTCP:18555 -sTCP:LISTEN
```

```bash
anvil --host 127.0.0.1 --port 18555 --chain-id 31337 --quiet
```

保持终端一运行。`--quiet` 隐藏启动日志，包括默认账户的密钥信息。

### 2. 终端二：进入项目，选择账户

从**仓库根目录**执行，后续命令都在同一个终端、同一个项目目录执行，保留变量：

```bash
cd multisig-wallet-15
forge --version
cast --version
jq --version

MULTISIG_RPC="http://127.0.0.1:18555"
cast chain-id --rpc-url "$MULTISIG_RPC"
```

Chain ID 应为 `31337`，不符时停止并检查 RPC。从当前节点读取公开账户地址，前三位为持有人，第四位负责执行，第五位收款：

```bash
MULTISIG_ACCOUNTS=$(cast rpc eth_accounts --rpc-url "$MULTISIG_RPC")
MULTISIG_OWNER_A=$(printf '%s' "$MULTISIG_ACCOUNTS" | jq -r '.[0]')
MULTISIG_OWNER_B=$(printf '%s' "$MULTISIG_ACCOUNTS" | jq -r '.[1]')
MULTISIG_OWNER_C=$(printf '%s' "$MULTISIG_ACCOUNTS" | jq -r '.[2]')
MULTISIG_EXECUTOR=$(printf '%s' "$MULTISIG_ACCOUNTS" | jq -r '.[3]')
MULTISIG_RECIPIENT=$(printf '%s' "$MULTISIG_ACCOUNTS" | jq -r '.[4]')
```

### 3. 部署三人两票钱包

由 A 部署，构造参数依次为三个持有人地址组成的数组、门槛 `2`。`--broadcast` 将部署交易发送到上面指定的本地链，`--json` 便于提取真实部署地址：

```bash
MULTISIG_DEPLOYMENT=$(forge create src/MultiSigWallet.sol:MultiSigWallet \
  --rpc-url "$MULTISIG_RPC" \
  --from "$MULTISIG_OWNER_A" \
  --unlocked \
  --broadcast \
  --json \
  --constructor-args "[$MULTISIG_OWNER_A,$MULTISIG_OWNER_B,$MULTISIG_OWNER_C]" 2)

printf '%s\n' "$MULTISIG_DEPLOYMENT" | jq .
MULTISIG_WALLET=$(printf '%s' "$MULTISIG_DEPLOYMENT" | jq -er '.deployedTo')
printf '%s\n' "$MULTISIG_WALLET"
```

成功结果包含 `deployer`、`deployedTo` 和 `transactionHash`。如果部署失败或地址提取失败，先解决错误，不要继续；不要用历史示例地址代替本次结果。

核对钱包持有人、门槛，以及执行者不属于持有人：

```bash
cast call "$MULTISIG_WALLET" 'getOwners()(address[])' --rpc-url "$MULTISIG_RPC"
cast call "$MULTISIG_WALLET" 'required()(uint256)' --rpc-url "$MULTISIG_RPC"
cast call "$MULTISIG_WALLET" 'isOwner(address)(bool)' "$MULTISIG_EXECUTOR" --rpc-url "$MULTISIG_RPC"
```

预期依次返回 A、B、C 的地址数组，`2`，`false`。

### 4. 给钱包充值 1 ETH

向钱包发送不带 calldata 的 ETH 转账，触发 `receive()`：

```bash
cast send "$MULTISIG_WALLET" \
  --value 1ether \
  --rpc-url "$MULTISIG_RPC" \
  --from "$MULTISIG_OWNER_A" \
  --unlocked

cast balance "$MULTISIG_WALLET" --ether --rpc-url "$MULTISIG_RPC"
```

回执应为 `status = 1`，钱包余额为 `1 ETH`。后续每次 `cast send` 都应等待成功回执后继续。

### 5. A 提交转出 0.1 ETH 的提案

这是新钱包的第一个提案，因此编号为 `0`。后续新提案应从各自的 `SubmitTransaction` 事件获取编号，不能一直使用 `0`。

```bash
MULTISIG_TX_ID=0

cast send "$MULTISIG_WALLET" \
  'submitTransaction(address,uint256,bytes)' \
  "$MULTISIG_RECIPIENT" 100000000000000000 0x \
  --rpc-url "$MULTISIG_RPC" \
  --from "$MULTISIG_OWNER_A" \
  --unlocked

cast call "$MULTISIG_WALLET" \
  'transactions(uint256)(address,uint256,bytes,bool,uint256)' "$MULTISIG_TX_ID" \
  --rpc-url "$MULTISIG_RPC"
```

返回顺序为收款地址、`100000000000000000` Wei、`0x`、`false`、`0`。提交不会付款，也不会自动确认。这里的金额是函数参数，不要加 `--value` 给 `submitTransaction`；它不是充值接口。

### 6. B、C 分别确认

先由 B 确认：

```bash
cast send "$MULTISIG_WALLET" 'confirmTransaction(uint256)' "$MULTISIG_TX_ID" \
  --rpc-url "$MULTISIG_RPC" \
  --from "$MULTISIG_OWNER_B" \
  --unlocked
```

此时只有一票，用只读模拟验证执行会失败；下面命令预期报告 `Not enough confirmations`，不会广播交易：

```bash
cast call "$MULTISIG_WALLET" 'executeTransaction(uint256)' "$MULTISIG_TX_ID" \
  --rpc-url "$MULTISIG_RPC" \
  --from "$MULTISIG_EXECUTOR"
```

再由 C 确认，并读取提案：

```bash
cast send "$MULTISIG_WALLET" 'confirmTransaction(uint256)' "$MULTISIG_TX_ID" \
  --rpc-url "$MULTISIG_RPC" \
  --from "$MULTISIG_OWNER_C" \
  --unlocked

cast call "$MULTISIG_WALLET" \
  'transactions(uint256)(address,uint256,bytes,bool,uint256)' "$MULTISIG_TX_ID" \
  --rpc-url "$MULTISIG_RPC"
```

预期 `executed = false`、`numConfirmations = 2`。达到门槛不会自动执行，也不会自动转账。

### 7. 非持有人执行，再核对结果

先记录收款方余额，再由独立的非持有人账户执行：

```bash
cast balance "$MULTISIG_RECIPIENT" --ether --rpc-url "$MULTISIG_RPC"

cast send "$MULTISIG_WALLET" 'executeTransaction(uint256)' "$MULTISIG_TX_ID" \
  --rpc-url "$MULTISIG_RPC" \
  --from "$MULTISIG_EXECUTOR" \
  --unlocked

cast call "$MULTISIG_WALLET" \
  'transactions(uint256)(address,uint256,bytes,bool,uint256)' "$MULTISIG_TX_ID" \
  --rpc-url "$MULTISIG_RPC"
cast balance "$MULTISIG_WALLET" --ether --rpc-url "$MULTISIG_RPC"
cast balance "$MULTISIG_RECIPIENT" --ether --rpc-url "$MULTISIG_RPC"
```

预期提案变为 `executed = true`，确认数仍为 `2`；钱包余额从 `1` 变为 `0.9 ETH`，收款方增加 `0.1 ETH`。执行者与收款方是不同账户，因此 Gas 不影响这里的收款余额差值。

再次只读模拟执行，预期报告 `Transaction already executed`：

```bash
cast call "$MULTISIG_WALLET" 'executeTransaction(uint256)' "$MULTISIG_TX_ID" \
  --rpc-url "$MULTISIG_RPC" \
  --from "$MULTISIG_EXECUTOR"
```

如果实际发送时出现超时，先用 `cast receipt <交易哈希> --rpc-url "$MULTISIG_RPC"` 和上面的提案查询核对结果，再决定是否重试。

### 8. 停止本地链

回到终端一按 `Ctrl+C`，只停止本次启动的 Anvil。本例没有保存链状态，停止后本地部署和余额不保留；下次启动后需要重新部署并更新变量。

## Sepolia 部署命令模板

本节仅提供命令，没有在公共链执行。需要自行准备可用 Sepolia RPC、三位实际持有人地址，以及有测试 ETH 的部署账户。使用已存在的 Foundry 加密 keystore，或由本人在终端交互式导入；不要使用 Anvil 默认账户或把私钥写进命令。

以下从**项目目录**执行。若尚未准备 keystore，可自行执行一次，按提示在本机输入，不向聊天或文档提供密钥：

```bash
cast wallet import multisig-deployer --interactive
```

用实际值替换占位项。这组变量与本地流程独立：

```bash
MULTISIG_SEPOLIA_RPC="https://你的Sepolia-RPC"
MULTISIG_SEPOLIA_OWNER_A="0x第一位持有人完整地址"
MULTISIG_SEPOLIA_OWNER_B="0x第二位持有人完整地址"
MULTISIG_SEPOLIA_OWNER_C="0x第三位持有人完整地址"

cast chain-id --rpc-url "$MULTISIG_SEPOLIA_RPC"
cast wallet address --account multisig-deployer
```

Chain ID 必须为 `11155111`。核对三个不同且非零的持有人地址、门槛 `2` 和 keystore 对应的部署账户。部署者只有被包含在持有人数组中时才有提交、确认权限。

先预演部署，不加 `--broadcast`，不发送交易：

```bash
forge create src/MultiSigWallet.sol:MultiSigWallet \
  --rpc-url "$MULTISIG_SEPOLIA_RPC" \
  --account multisig-deployer \
  --constructor-args "[$MULTISIG_SEPOLIA_OWNER_A,$MULTISIG_SEPOLIA_OWNER_B,$MULTISIG_SEPOLIA_OWNER_C]" 2
```

确认预演结果和费用后，由本人执行实际部署。以下示例限制 Gas 为 `2500000`、每 Gas 最高 `2 gwei`，部署费用上限为 `0.005 Sepolia ETH`；这是模板上限，不是实测报价。若估算或网络基础费超过上限，应重新评估，不要盲目提高：

```bash
forge create src/MultiSigWallet.sol:MultiSigWallet \
  --rpc-url "$MULTISIG_SEPOLIA_RPC" \
  --account multisig-deployer \
  --gas-limit 2500000 \
  --gas-price 2gwei \
  --priority-gas-price 1gwei \
  --broadcast \
  --constructor-args "[$MULTISIG_SEPOLIA_OWNER_A,$MULTISIG_SEPOLIA_OWNER_B,$MULTISIG_SEPOLIA_OWNER_C]" 2
```

保存输出的部署地址与交易哈希，替换下面占位值后核验：

```bash
MULTISIG_SEPOLIA_WALLET="0x本次实际部署地址"
MULTISIG_SEPOLIA_DEPLOY_TX="0x本次部署交易哈希"

cast receipt "$MULTISIG_SEPOLIA_DEPLOY_TX" --rpc-url "$MULTISIG_SEPOLIA_RPC"
cast call "$MULTISIG_SEPOLIA_WALLET" 'getOwners()(address[])' --rpc-url "$MULTISIG_SEPOLIA_RPC"
cast call "$MULTISIG_SEPOLIA_WALLET" 'required()(uint256)' --rpc-url "$MULTISIG_SEPOLIA_RPC"
```

应确认回执成功且持有人、门槛正确。公共链上的充值、提交、确认、执行使用相同合约接口，但每个发送者必须使用自己的钱包或 keystore，通过 `--account` 签名，不使用 `--unlocked`；每笔交易分别核对目标、金额和费用。

## Remix VM 手动练习

以下是可复现的操作步骤和预期结果。Remix UI 操作未在本次实测范围内，命令行验证记录见文末。

1. 在 Remix 新建 `contracts/MultiSigWallet.sol`，复制本项目合约源码。选择 Solidity `0.8.24`、EVM `shanghai`、关闭优化，完成编译。
2. 在 Deploy & Run 选择本地 `Remix VM`，从账户列表复制三个不同地址作为 A、B、C，再选一个不在持有人列表中的 D。
3. 展开部署参数，`initialOwners` 填入由 A、B、C 实际地址构成的数组，`requiredConfirmations` 填 `2`，Value 保持 `0 Wei`，部署钱包。
4. 给钱包充值：Value 设为 `1 Ether`，在该合约的 Low level interactions 中保持 Calldata 为空并点击 Transact，触发 `receive()`。充值后将 Value 改回 `0 Wei`。
5. 切换账户 A，调用 `submitTransaction`：`to` 填 D，`value` 填 `100000000000000000`（`0.1 ETH`），`data` 填 `0x`。第一个提案编号为 `0`；读取 `transactions(0)`，确认数应为 `0`。
6. 切换 B，调用 `confirmTransaction(0)`；确认数应为 `1`。此时执行会因 `Not enough confirmations` 回滚。
7. 切换 C，调用 `confirmTransaction(0)`；确认数应为 `2`。
8. 切换非持有人 D，调用 `executeTransaction(0)`；成功后 `executed` 为 `true`，钱包余额为 `0.9 ETH`。D 收到 `0.1 ETH`，同时自身支付执行 Gas。
9. 再执行 `executeTransaction(0)`，预期因 `Transaction already executed` 回滚。

部署参数数组格式如下，需用 Remix VM 的实际账户地址替换占位文本：

```text
["A的完整地址", "B的完整地址", "C的完整地址"]
```

## 范围与本次验证

本项目是固定持有人的教学多签，不包含持有人更换、门槛调整、撤销确认、提案取消、过期时间、离线签名或前端。确认一旦达到门槛，任何人都可以执行，且没有撤销入口。

执行成功表示 EVM `call` 没有回滚；钱包不会解析目标函数的返回值。例如目标函数返回 `false` 但不回滚时，提案仍会标记成功，因此确认前需要理解目标函数的实际语义。

2026-09-22 在 Foundry `1.8.1`、Solidity `0.8.24` 的本地环境运行：9 项测试通过，0 失败，0 跳过。没有部署或广播到公共链，没有使用真实资金。

同日补充命令行实测：按本文命令在独立 Anvil（`127.0.0.1:18555`、Chain ID `31337`）完成部署、充值、提案、B/C 确认和非持有人执行。钱包余额从 `1` 变为 `0.9 ETH`，独立收款账户增加 `0.1 ETH`，提案最终为 `executed = true`、确认数 `2`；一票执行和重复执行的只读模拟均按预期拒绝。验证后已停止本次 Anvil。

临时命令输出与回执保存在仓库的 `output-tdd/multisig-wallet-15/`，不纳入提交。Sepolia 命令仅完成本地参数与 Shell 语法核对，未连接公共 RPC、解锁真实账户或广播公共链交易。

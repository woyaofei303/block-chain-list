# Vault CTF：delegatecall、存储碰撞与重入

本项目是一个本地 Foundry 安全练习。题目要求阅读 `Vault.sol`，编写攻击合约清空 Vault，并让 Forge 测试通过。合约故意保留漏洞，仅用于本地 EVM 验证，不应部署到公共链。

## 代码阅读顺序

1. [项目规则](AGENTS.md)：验证范围、秘密和本地产物边界。
2. [src/Vault.sol](src/Vault.sol)：Vault、逻辑合约、存储布局及提款流程。
3. [test/Vault.t.sol](test/Vault.t.sol)：`VaultHacker` 的 ABI 编码、owner 接管和重入 PoC。
4. [script/Vault.s.sol](script/Vault.s.sol)：使用 Forge CLI 发送者部署逻辑合约和 Vault。

## 漏洞链

`Vault` 的 `fallback()` 将任意 calldata `delegatecall` 到 `VaultLogic`。两份合约的存储布局不兼容：Vault 的 slot 1 是 `logic` 地址，而逻辑合约把 slot 1 当作 `password`。因此攻击者可以把逻辑合约地址按 `bytes32` ABI 编码，调用 `changeOwner` 并改写 Vault slot 0 的 `owner`。

接管 owner 后，攻击者调用 `openWithdraw()`，再存入一笔 ETH。`withdraw()` 在外部转账之后才把存款清零，攻击合约的 `receive()` 可以重入并重复提取同一笔存款。本题的测试状态中，攻击者存入 `0.1 ETH` 后重入一次，正好清空 Vault 的 `0.2 ETH` 余额。

## 本地测试

从**仓库根目录**进入项目目录执行：

```bash
cd vault-22
forge --version
forge fmt --check
forge build
forge test -vvv
```

预期：`testExploit` 通过，Vault 余额为零。测试运行在 Forge 本地 EVM，不需要 Anvil、RPC、钱包或环境变量。

## 本地 Anvil 部署

以下命令只使用本地 Anvil 解锁账户，不读取或打印私钥。先在终端 A 检查端口并启动节点：

```bash
lsof -nP -iTCP:18549 -sTCP:LISTEN
anvil --host 127.0.0.1 --port 18549 --chain-id 31337 --silent
```

在终端 B 从**仓库根目录**进入项目，读取公开测试账户，先模拟部署：

```bash
cd vault-22
export VAULT_RPC_URL="http://127.0.0.1:18549"
export VAULT_SENDER="$(cast rpc eth_accounts --rpc-url "$VAULT_RPC_URL" | jq -r '.[0]')"
test "$(cast chain-id --rpc-url "$VAULT_RPC_URL")" = 31337
forge script script/Vault.s.sol:VaultScript \
  --rpc-url "$VAULT_RPC_URL" \
  --sender "$VAULT_SENDER" \
  -vvvv
```

确认模拟输出后，在同一 Anvil 上广播本地部署：

```bash
forge script script/Vault.s.sol:VaultScript \
  --rpc-url "$VAULT_RPC_URL" \
  --sender "$VAULT_SENDER" \
  --unlocked --broadcast -vvvv
```

从广播输出记录 `Vault deployed at` 后设置地址并核验代码、余额和解题状态：

```bash
export VAULT_ADDRESS="0x0000000000000000000000000000000000000000"
cast code "$VAULT_ADDRESS" --rpc-url "$VAULT_RPC_URL"
cast balance "$VAULT_ADDRESS" --ether --rpc-url "$VAULT_RPC_URL"
cast call "$VAULT_ADDRESS" 'isSolve()(bool)' --rpc-url "$VAULT_RPC_URL"
cast call "$VAULT_ADDRESS" 'owner()(address)' --rpc-url "$VAULT_RPC_URL"
```

`VAULT_ADDRESS` 必须替换为脚本实际输出的地址。部署脚本会预存 `0.1 ETH`，因此初始 `isSolve()` 应为 `false`。攻击 PoC 只在测试合约中执行，不提供公共链提款命令。

## 已知限制

- `Vault.sol` 是故意的脆弱示例，不是可部署的钱包实现。
- `isSolve()` 在非零余额路径依赖 Solidity 默认返回 `false`，编译器可能提示未显式赋值。
- `receive()` 接收的直接转账不会写入 `deposites`，这是题目简化造成的记账边界。

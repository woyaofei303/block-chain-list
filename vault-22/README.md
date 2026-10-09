# 22 · Vault 本地安全题：存储错位与重入为什么会丢钱

这是故意保留漏洞的本地 CTF（安全练习题）。学习目标是读懂一条错误链：代理用错存储位置，攻击合约成为 owner，再利用“先转钱后清账”重复提款。只在仓库测试与自己的 Anvil 中复现。

先读 [18 的存储槽](../esrnt-storage-18/README.md) 和 [21 的代理](../upgradeable-nft-market-21/README.md)，这里正好展示不遵守布局约束的后果。

## 第一个问题：同一个槽被解释成两种数据

```text
Vault 的 slot 0 = owner       VaultLogic 的 slot 0 = owner
Vault 的 slot 1 = logic 地址  VaultLogic 的 slot 1 = password
```

Vault 的 fallback 把请求 delegatecall 给 VaultLogic，执行的是后者代码，却读取 Vault 的存储。于是 VaultLogic 检查 password 时，实际拿到 Vault 的 logic 地址。

测试使用已知逻辑地址构造这个槽的值，调用 `changeOwner` 后改的是 Vault 的 owner。这里不是破解强密码，而是程序把错误位置的数据当作密码比较。

## 第二个问题：钱已转出，账还没扣

原存款人为 Vault 放入 0.1 ETH。攻击合约接管 owner 后开启提款，再存入自己的 0.1 ETH，此时 Vault 有 0.2 ETH。

提款先发送 0.1，尚未把攻击者存款清零；攻击合约的 `receive` 在收款时再调一次 withdraw，旧账仍显示可提 0.1，于是又转出 0.1。最后两层调用返回才清账，Vault 余额归零。

**重入**就是外部调用尚未结束，接收方回头再次进入同一业务。这里测试的余额正好支持一次重入；不要把这个固定示例推广为任意余额都必然成功。

## 先跟测试，不直接部署到公共链

[Vault.t.sol](test/Vault.t.sol) 的 `setUp` 建立原始存款，`testExploit` 发起攻击，最后检查 `isSolve()`。对照调用轨迹，重点看 owner 何时变化，以及两次转账之间 `deposites` 为什么还是旧数。

注意源码中的 `deposite` / `deposites` 保留题目拼写。直接 ETH 转账只进入 `receive`，不会记入这份存款映射。

防御上应保持代理布局兼容、限制敏感入口，提款先更新状态再调用外部合约，并根据场景设置重入保护。本课保留漏洞供观察，不把它改成生产钱包。2026-10-09 已在测试 EVM 中通过攻击回归测试，没有向公共链广播。原题仍有构造器可见性及未赋值返回值的编译告警，未把此教学漏洞合约改造成生产实现。

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
export VAULT_ADDRESS="<本次脚本输出的Vault地址>"
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

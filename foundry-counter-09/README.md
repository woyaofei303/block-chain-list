# foundry-counter

Foundry 合约练习项目，包含：

- `src/Counter.sol`：设置、递增计数，并发出 `NumberChanged22` 事件。
- `src/MyToken.sol`：OpenZeppelin ERC20 代币，构造参数为名称和符号。
  精度为 18，固定发行 100 亿枚（`10_000_000_000 * 1e18` 个最小单位），部署时全部发给部署者。

以下命令在 `foundry-counter-09` 目录中执行。依赖使用现有的
`lib/forge-std` 和 `lib/openzeppelin-contracts`，导入路径由 `remappings.txt` 配置。
两个依赖均作为源码随仓库保存，克隆后无需初始化子模块。
其中 forge-std 为 `v1.16.2`，源码版本为 `bf647bd6046f2f7da30d0c2bf435e5c76a780c1b`。

## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
forge build --sizes
```

### Test

```shell
forge test -vv
```

测试包含 Counter 的设置和递增、MyToken 初始发行量、转账与授权转账的模糊测试，
以及零地址、余额不足和未授权转账的失败路径。

### Format

```shell
forge fmt
forge fmt --check
```

### Gas Snapshots

```shell
forge snapshot
```

### Anvil

```shell
anvil
```

### 本地部署模拟

无需 RPC 或私钥；以下命令只在本地 EVM 模拟，不发送链上交易。

```shell
forge script script/Counter.s.sol:CounterScript
forge script script/MyToken.s.sol:MyTokenScript --sig "run(string,string)" "My Token" "MTK"
```

### Sepolia 部署

使用已导入 Foundry keystore 的 `deployer` 账户，将 `<DEPLOYER_ADDRESS>` 替换为该账户地址。
`sepolia` RPC 已在 `foundry.toml` 配置；`--broadcast` 会实际发送交易，初始代币归该部署账户。

```shell
forge script script/MyToken.s.sol:MyTokenScript \
  --sig "run(string,string)" "My Token" "MTK" \
  --rpc-url sepolia \
  --account deployer \
  --sender <DEPLOYER_ADDRESS> \
  --broadcast
```

### Cast

```shell
cast --help
```

### Help

```shell
forge --help
anvil --help
cast --help
```

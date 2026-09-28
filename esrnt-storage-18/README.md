# 使用 Viem 读取 esRNT 私有数组

本练习根据本次提供的 `esRNT` 题目实现：使用 Viem `getStorageAt` 读取 `_locks` 的全部元素，并逐行打印 `user`、`startTime`、`amount`。完整实测输出见 [RUN_LOG.md](RUN_LOG.md)。

保留原题的 `private` 数组与构造公式，仅修正 `I+1` 为 `i+1`，补齐 SPDX 与 Solidity 版本。没有添加 getter。`private` 限制 Solidity 层面的访问，不会加密链上存储。未提供公共链地址，因此本次记录来自独立本地 Anvil，不代表 Sepolia 或主网部署。

## 阅读顺序与存储位置

1. [src/esRNT.sol](src/esRNT.sol)：构造函数写入 11 项。
2. [src/read-locks.ts](src/read-locks.ts)：读取长度、计算元素槽、拆解字段和打印结果。
3. [test/read-locks.test.ts](test/read-locks.test.ts) 与 [test/esRNT.t.sol](test/esRNT.t.sol)：分别检查读取器的边界及实际 Solidity 存储布局。
4. [script/Deploy.s.sol](script/Deploy.s.sol)：通过 `forge script` 模拟或部署。
5. [RUN_LOG.md](RUN_LOG.md)：本次运行环境、部署证据和全部输出。

本合约没有继承，也没有位于 `_locks` 前面的状态变量，因此长度在 slot `0`。每个结构体占 64 字节：

```text
slot 0 = _locks.length
base = keccak256(32 字节编码的 uint256(0))

locks[i] 的第一个槽 = base + 2 * i
  低 160 位：user（address，20 字节）
  接着 64 位：startTime（uint64，8 字节）
  高 32 位：未使用

locks[i] 的第二个槽 = base + 2 * i + 1
  全部 256 位：amount（uint256，32 字节）
```

核心解码公式：

```typescript
const base = BigInt(keccak256(toHex(0n, { size: 32 })))
const slot = base + i * 2n
const user = toHex(packed & ((1n << 160n) - 1n), { size: 20 })
const startTime = (packed >> 160n) & ((1n << 64n) - 1n)
```

`packed` 通过 `getStorageAt({ address, slot: toHex(slot, { size: 32 }), blockNumber })` 获得；`amount` 从下一个槽读取。时间和金额始终使用 `bigint`，直接输出原始十进制整数。这里的 `amount` 是题目中的存储值，不能仅凭 `1e18` 判断实际代币资产或余额。

参考：[Solidity 存储布局](https://docs.soliditylang.org/en/v0.8.24/internals/layout_in_storage.html)、[Viem getStorageAt](https://viem.sh/docs/contract/getStorageAt)。

## 安装与检查

需要 Node.js 24+、npm、Foundry（`forge`、`anvil`、`cast`）及 `jq`。Node 直接执行 TypeScript；`tsc` 单独完成严格类型检查。Solidity 不依赖第三方库。

从**仓库根目录**进入项目：

```bash
cd esrnt-storage-18
npm ci
npm run check
```

`npm run check` 包含 Biome lint/format 检查、TypeScript 类型检查、Node 测试、Forge 格式检查、构建和测试。`prepare` 保留仓库的共享 Husky hooksPath；暂存本目录时，共享钩子运行 lint-staged、类型检查、Node 测试及 Forge 检查。

## 完整本地运行

以下终端都从**项目目录 `esrnt-storage-18/`** 执行。

### 1. 启动独立 Anvil

先检查端口，已有进程占用时不要覆盖或停止它；更换端口时同时更新后续 RPC_URL。

```bash
lsof -nP -iTCP:18548 -sTCP:LISTEN
anvil --host 127.0.0.1 --port 18548 --chain-id 31337 --hardfork shanghai --timestamp 1800000000 --silent
```

`1800000000` 是可复现的模拟链起始时间，不是运行当天时间。`--silent` 避免输出 Anvil 的测试私钥。结束练习后，在启动 Anvil 的终端按 Ctrl+C，仅停止本次节点。

### 2. 在第二个终端模拟部署

```bash
export RPC_URL='http://127.0.0.1:18548'
export DEPLOYER="$(cast rpc eth_accounts --rpc-url "$RPC_URL" | jq -r '.[0]')"
cast chain-id --rpc-url "$RPC_URL"

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" -vv
```

预期 chain ID 为 `31337`，脚本模拟成功，返回 `deployed` 地址。模拟不会将合约写入 Anvil 链。

### 3. 广播到本地链并获取地址

确认当前 RPC 是上一步自己的本地节点后执行；`--unlocked` 使用节点测试账户，不需要私钥。

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" --unlocked --broadcast -vv

export CONTRACT_ADDRESS="$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "esRNT") | .contractAddress' broadcast/Deploy.s.sol/31337/run-latest.json)"
export TX_HASH="$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "esRNT") | .hash' broadcast/Deploy.s.sol/31337/run-latest.json)"

cast receipt "$TX_HASH" --rpc-url "$RPC_URL"
cast code "$CONTRACT_ADDRESS" --rpc-url "$RPC_URL"
cast storage "$CONTRACT_ADDRESS" 0 --rpc-url "$RPC_URL"
cast balance "$CONTRACT_ADDRESS" --rpc-url "$RPC_URL"
```

预期交易成功、代码非空、slot 0 的值为十六进制 `0x0b`（补齐 32 字节），合约 ETH 余额为 `0`。广播中断时先检查已有回执和广播文件，避免重复部署。

本题合约没有可调用的公开函数，因此使用原始存储查询验证数据，不调用不存在的 getter。

### 4. 使用 Viem 读取全部 11 项

```bash
export BLOCK_NUMBER="$(cast block-number --rpc-url "$RPC_URL")"
npm run read
```

输出区块信息、数组长度，以及如下格式的全部记录：

```text
locks[0]: user:0x0000000000000000000000000000000000000001 ,startTime:部署区块时间乘2,amount:1000000000000000000
...
locks[10]: user:0x000000000000000000000000000000000000000b ,startTime:部署区块时间乘2减10,amount:11000000000000000000
```

以上是预期格式；真实数字见运行日志。因为构造函数只在部署时运行，公式中的时间必须取**部署区块**，不能换成稍后查询区块的时间。

如需保留新的原始日志，在项目目录执行：

```bash
mkdir -p ../output-tdd/esrnt-storage-18
npm run read > ../output-tdd/esrnt-storage-18/read.log
cat ../output-tdd/esrnt-storage-18/read.log
```

也可在不存在本地 `.env` 时复制 `.env.example`，填入公开配置；不要覆盖已有 `.env`。支持：

- `RPC_URL`：HTTP(S) RPC，默认 `http://127.0.0.1:18548`。可能包含凭据，不打印到运行日志。
- `CONTRACT_ADDRESS`：必须提供，目标必须在查询区块有代码。
- `BLOCK_NUMBER`：可选的非负十进制区块号；省略时在读取开始时选定最新区块。全部字段使用同一区块号。

## 读取已有链上的同布局合约

从**项目目录**设置下面三个值即可。读取过程只发起只读 RPC，不需要钱包、签名或 Gas。

```bash
export RPC_URL='https://替换为目标网络RPC'
export CONTRACT_ADDRESS='0x替换为目标合约地址'
unset BLOCK_NUMBER
npm run read
```

本工具面向题目中的确切布局，不会自动识别其他合约或代理布局；存在代码不等于布局正确。读取历史区块要求 RPC 保留该区块状态。按区块号读取可避免混用不同最新高度，但无法完全防止读取期间发生区块重组；公共链取已确认区块更稳妥。程序按元素顺序读取，每项并行查询两个槽，适用于本练习的小数组。

公共链部署属于另一个操作范围，本指南仅演示本地部署和已有链状态的只读查询。

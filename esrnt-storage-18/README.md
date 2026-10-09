# 18 · 读懂链上存储：private 为什么仍能读取

Solidity 的 `private` 表示其他合约不能通过普通成员访问直接读取它，不表示数据被加密。本项目没有 getter，却能用 Viem 的 `getStorageAt` 读出 `_locks` 的 11 条记录。

这份实验练习存储布局，不处理真实锁仓资产。先了解 [04 的合约状态](../firstcontract-04/README.md)，再跟着一个元素计算它的位置。

## 从“抽屉”理解 storage slot

链上持久存储按 32 字节一个槽（slot）组织。动态数组的槽 0 只放长度，元素从 `keccak256(abi.encode(uint256(0)))` 对应的位置开始，并不紧跟在槽 1。

每条记录是 `address user + uint64 startTime + uint256 amount`：地址 20 字节、时间 8 字节，可以合放一个 32 字节槽；金额需要完整 32 字节，放下一个槽。因此每条占两个槽。

```text
slot 0 = 11
base = keccak256(32字节的0)
第 i 条：base + 2*i 存 user 和 startTime
         base + 2*i + 1 存 amount
```

读回第一槽后，低 160 位是地址，再向右移 160 位取 64 位时间。剩余高位不是金额；金额在另一个槽。这个位置计算只适用于本项目的确切字段顺序。

## 用第 0 条和第 10 条核对公式

设部署区块时间为 T，构造函数写入：

```text
i=0： user=0x0000000000000000000000000000000000000001，startTime=2T，amount=10^18
i=10：user=0x000000000000000000000000000000000000000b，startTime=2T-10，amount=11×10^18
```

这里 `amount` 只是题目保存的整数；不能看到 `10^18` 就当作合约真的持有 1 ETH。时间来自**部署时**，不是读取时。

读取程序先固定一个区块号，之后长度与元素全部用它查询，避免读到不同高度的混合状态。时间和金额用 `bigint`，保留完整整数。

## 按这个顺序读代码

1. [esRNT.sol](src/esRNT.sol)：先看结构体和构造公式，不需要添加 getter。
2. [read-locks.ts](src/read-locks.ts)：看选定区块、槽定位、解码和逐条输出。
3. [read-locks.test.ts](test/read-locks.test.ts)：检查打包边界和错误输入。
4. [RUN_LOG](RUN_LOG.md)：把历史 11 条输出代回公式；其中本地地址不是公共链部署。

下面保留从安装到读取的可复制操作。每一步的数值是预期。2026-10-09 已在独立 Anvil 部署并用 Viem 和 CLI 读取全部 11 项，逐项核对地址、部署时间公式和金额；1 项 Forge、2 项 Node.js 测试及 lint、类型检查通过。

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

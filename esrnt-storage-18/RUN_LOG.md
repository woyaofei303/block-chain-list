# esRNT 私有存储读取：本次运行日志

运行日期：2026-09-28（Asia/Shanghai）。本记录来自本次实际执行，网络为独立的 **本地 Anvil 模拟链**，不是公共测试网或主网。原始临时日志和广播文件保持本地忽略，本文件保存用户要求交付的公开记录。

## 环境

```text
Node.js: v24.14.0
npm: 11.9.0
Viem: 2.56.7
TypeScript: 5.9.3
Solidity: 0.8.24
Forge / Anvil: 1.8.1
EVM: Shanghai
Chain ID: 31337
RPC: http://127.0.0.1:18548
Anvil genesis timestamp: 1800000000（人工设定）
```

链时间是为练习固定的模拟时间。部署块时间由实际出块确定，因此稍后重跑时 `startTime` 数值可以不同。

## 1. 编译、测试与布局检查

以下命令在 `esrnt-storage-18/` 执行并通过：

```bash
npm run check
forge inspect esRNT storageLayout --json
```

本次结果摘要：

```text
Biome check: Checked 5 files. No fixes applied.
TypeScript: tsc --noEmit, exit code 0
Node tests: 2 passed, 0 failed
Forge format: passed
Compiler run successful! (Solc 0.8.24)
[PASS] testAllPrivateLocks()
Forge tests: 1 passed, 0 failed
```

共享提交钩子也已在仅暂存本次文件后实际执行：`sh multi-chat-py-01/web/.husky/pre-commit`，退出码为 `0`。本项目 lint-staged、类型检查及测试通过；钩子原有的聊天 Web 类型检查和 14 项测试也通过。

Node 测试覆盖可变数组长度、两槽步长、完整 160 位地址、uint64/uint256 最大值、非零高位填充、零金额、空数组、无代码地址、无效输入和缺失/短 RPC 响应。Forge 测试读取真实部署的 11 项存储。

`forge build` 另有静态建议：保留原题的显式类型转换、测试中循环读取 cheatcode，以及接口/常量命名等风格提示；这些未导致编译失败。截取地址和时间位宽是本题解码的预期行为。

编译器布局核对结果：

```text
_locks: slot 0, offset 0, dynamic_array
LockInfo: 64 bytes
user: relative slot 0, offset 0, address
startTime: relative slot 0, offset 20, uint64
amount: relative slot 1, offset 0, uint256
```

## 2. 部署模拟和本地广播

在项目目录执行：

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:18548 \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 -vv

forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:18548 \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --unlocked --broadcast -vv
```

真实终端结果摘要：

```text
Script ran successfully.
deployed: contract esRNT 0x5FbDB2315678afecb367f032d93F642f64180aa3
SIMULATION COMPLETE.
ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
```

回执与状态核对：

```text
transactionHash: 0x160f387df0db0cc5c976521277096354232080ab6bcdc88b8ae2b9e51186ee05
status: 0x1 (success)
contractAddress: 0x5fbdb2315678afecb367f032d93f642f64180aa3
blockNumber: 1
blockHash: 0x9c9d14b80a2ca55f553370875eeee0d2fccc52b24505392034849e96a472960c
blockTimestamp: 1800000029
gasUsed: 590841
contract code: non-empty
slot 0: 0x000000000000000000000000000000000000000000000000000000000000000b
contract ETH balance: 0
```

## 3. Viem 完整读取输出

在项目目录执行；读取使用 `getStorageAt`，不使用合约 ABI/getter，也不读取事件：

```bash
RPC_URL=http://127.0.0.1:18548 \
CONTRACT_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3 \
BLOCK_NUMBER=1 \
npm run read
```

原始标准输出：

```text
> read
> node --env-file-if-exists=.env src/read-locks.ts

chainId: 31337, contract: 0x5fbdb2315678afecb367f032d93f642f64180aa3
blockNumber: 1, blockHash: 0x9c9d14b80a2ca55f553370875eeee0d2fccc52b24505392034849e96a472960c
blockTimestamp: 1800000029, locks.length: 11
locks[0]: user:0x0000000000000000000000000000000000000001 ,startTime:3600000058,amount:1000000000000000000
locks[1]: user:0x0000000000000000000000000000000000000002 ,startTime:3600000057,amount:2000000000000000000
locks[2]: user:0x0000000000000000000000000000000000000003 ,startTime:3600000056,amount:3000000000000000000
locks[3]: user:0x0000000000000000000000000000000000000004 ,startTime:3600000055,amount:4000000000000000000
locks[4]: user:0x0000000000000000000000000000000000000005 ,startTime:3600000054,amount:5000000000000000000
locks[5]: user:0x0000000000000000000000000000000000000006 ,startTime:3600000053,amount:6000000000000000000
locks[6]: user:0x0000000000000000000000000000000000000007 ,startTime:3600000052,amount:7000000000000000000
locks[7]: user:0x0000000000000000000000000000000000000008 ,startTime:3600000051,amount:8000000000000000000
locks[8]: user:0x0000000000000000000000000000000000000009 ,startTime:3600000050,amount:9000000000000000000
locks[9]: user:0x000000000000000000000000000000000000000a ,startTime:3600000049,amount:10000000000000000000
locks[10]: user:0x000000000000000000000000000000000000000b ,startTime:3600000048,amount:11000000000000000000
```

## 4. 独立结果核对

从部署回执对应区块取得时间 `1800000029`，再解析上述实际输出。逐项断言：索引为 `0..10`、`user == address(i + 1)`、`startTime == 部署区块时间 * 2 - i`、`amount == 10**18 * (i + 1)`，同时检查编译器给出的 64 字节结构体布局。

```text
PASS: receipt status, compiler storage layout, all 11 rows / 33 fields, bigint amounts
```

重新运行的完整命令与环境配置见 [README.md](README.md)。本合约仅构造这些教学记录，未发生真实资产锁仓或公共链交易。

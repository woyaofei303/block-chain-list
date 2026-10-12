# 26 · Flash Swap：借 A、换 B，用 B 还款

本练习部署两个自己的 `MyToken`、两套 Uniswap V2 Factory/Router，以及两个 A/B 池。策略从 PoolA 临时取出 A，在 PoolB 换成 B，再把应还的 B 转给 PoolA，剩余 B 转给部署者。全部发生在一笔交易中，任一步失败，两个池的兑换与代币转账一起回滚。

题面要求在 **Sepolia** 执行，并提交代码库链接与成功日志。本项目提供相应脚本；本地 Anvil 的成功记录只能证明本地流程，不能冒充测试网证据。公共链实际状态见文末验证记录。

## 用 100 A 走一遍

两种币均为 18 位精度，各发行 100 万枚给部署者，不开放后续铸币。两个 Factory 各创建一个相同币对的 Pair，因此可以存在两份不同储备：

```text
PoolA：10,000 A + 20,000 B，初始储备比为 1 A : 2 B
PoolB：10,000 A + 30,000 B，初始储备比为 1 A : 3 B
```

PoolB 愿意为 A 付出更多 B，但储备比不是大额交易的成交价。兑换会改变储备，而且每个池都收取 0.3% 交易手续费。初始状态借 `100 A` 的精确计算为：

```text
PoolB 输出 B = 100 × 997 × 30,000 / (10,000 × 1000 + 100 × 997)
             = 296.147410319118389655 B（按最小单位向下取整）

PoolA 应还 B = 20,000 × 100 × 1000 / ((10,000 - 100) × 997)
             = 202.628086279039137615 B（整数除法后加 1 个最小单位）

本次利润 B   = 93.519324040079252040 B
```

实际合约使用代币最小单位做整数计算。不能把还款写成 `100 A × 1.003`，因为本题借 A、还 B，必须使用 PoolA 的异币偿还价格。上述利润已扣两次兑换手续费，**没有扣 ETH gas 费用**，也不代表真实市场保证有利润。

```text
部署者 → FlashSwap.execute(100 A, 至少 90 B 利润, 截止时间)
         └─ PoolA.swap(..., 非空 data)
             ├─ PoolA → FlashSwap：100 A
             ├─ PoolA → FlashSwap.uniswapV2Call
             │   ├─ 验证 msg.sender 是 PoolA、sender 是 FlashSwap
             │   ├─ FlashSwap → PoolB：100 A
             │   ├─ PoolB.swap(..., 空 data) → FlashSwap：约 296.1474 B
             │   ├─ FlashSwap → PoolA：约 202.6281 B
             │   └─ FlashSwap → 部署者：约 93.5193 B
             └─ PoolA 检查含手续费的储备乘积 K，然后更新储备
```

回调名是 **`uniswapV2Call`**，开头为小写 `u`。`sender` 是调用 Pair.swap 的 FlashSwap 合约，不是钱包。PoolA 转出 A 时还没有更新储备，回调中读取的仍是本次借款前的储备，可用于计算还款。PoolB 使用空 `data`，所以只是普通兑换，不再回调。

## 从哪里读代码

1. [MyToken.sol](src/MyToken.sol)：继承仓库已有 OpenZeppelin ERC20，部署两次得到两种币。
2. [FlashSwap.sol](src/FlashSwap.sol)：先读 `execute → uniswapV2Call`，再看 `quote` 的还款与兑换公式。
3. [FlashSwap.t.sol](test/FlashSwap.t.sol)：用实际 V2 合约验证正反地址顺序、回调认证、费用、利润限制与失败回滚。
4. [DeployFlashSwap.s.sol](script/DeployFlashSwap.s.sol) 和 [ExecuteFlashSwap.s.sol](script/ExecuteFlashSwap.s.sol)：分别负责部署加池与单笔套利。

官方 [ExampleFlashSwap](https://github.com/Uniswap/v2-periphery/blob/ed24991304291297c3b4a52818d02f46a17aa9a2/contracts/examples/ExampleFlashSwap.sol) 是 V2/V1 示例。本实现参考其回调认证、兑换、偿还和利润分配顺序，改成两个 V2 池，不使用 V1 或 ETH 兑换。异币偿还依据 [Uniswap 官方闪电兑换说明](https://developers.uniswap.org/docs/protocols/v2/guides/flash-swaps)。

## 先编译和测试

需要完整仓库以及 `forge`、`cast`、`anvil`、`jq`。从仓库根目录执行：

```bash
forge build --root uniswap-v2-25
cd flash-swap-26
forge fmt --check
forge build
forge test -vv
```

本项目源码使用 Solidity `0.8.24`。V2 的 Factory/Pair/Router/WETH 使用 [25 号工程](../uniswap-v2-25/README.md) 生成的旧版本产物，通过 JSON 字节码部署，避免把 `0.5.16/0.6.6` 实现导入 `0.8.24`。Router 的创建字节码哈希必须与 Pair 匹配，所以不要只重编译或替换其中一部分。来源及许可证见 [25 的 UPSTREAM](../uniswap-v2-25/UPSTREAM.md)。

`foundry.toml` 只为该产物目录开放读取权限。找不到 Factory JSON 时，先执行上述第一条命令；单独下载 `flash-swap-26` 不能运行。本题没有前端或 Node 工程，不需要安装 npm 包。

## 本地完整操作

以下命令均从 `flash-swap-26` 目录执行。先模拟部署，不连接 RPC、不广播：

```bash
forge script script/DeployFlashSwap.s.sol:DeployFlashSwap \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 -vv
```

在终端 A 检查独立端口，没有输出表示未查到监听者；有输出时先确认进程，不要终止未知服务：

```bash
lsof -nP -iTCP:18645 -sTCP:LISTEN
```

端口空闲才启动节点并保持运行；`--silent` 避免打印本地默认私钥：

```bash
anvil --host 127.0.0.1 --port 18645 --chain-id 31337 --silent
```

终端 B 同样进入本项目目录，设置公开参数并检查 chain ID 应为 `31337`：

```bash
export RPC_URL=http://127.0.0.1:18645
export ACCOUNT=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export CHAIN_ID=31337
export LOG_DIR=../output-tdd/flash-swap-26
mkdir -p "$LOG_DIR"
cast chain-id --rpc-url "$RPC_URL"
```

在新节点上部署一次。脚本部署两币、共享 WETH、两套 Factory/Router、套利合约，并通过各自 Router 加池，共 **14 笔交易**。LP 留给部署者，授权只涵盖本次加池金额：

```bash
forge script script/DeployFlashSwap.s.sol:DeployFlashSwap \
  --rpc-url "$RPC_URL" --sender "$ACCOUNT" --unlocked --broadcast -vv
```

从实际广播记录提取套利合约地址，再查询其绑定地址，不能复制前面离线模拟的地址：

```bash
export RUN="$LOG_DIR/broadcast/DeployFlashSwap.s.sol/$CHAIN_ID/run-latest.json"
jq -e '(.receipts | length == 14) and all(.receipts[]; .status == "0x1")' "$RUN"
export FLASH_SWAP=$(jq -r '.transactions[] | select(.contractName == "FlashSwap" and .transactionType == "CREATE") | .contractAddress' "$RUN")
export TOKEN_A=$(cast call "$FLASH_SWAP" 'tokenA()(address)' --rpc-url "$RPC_URL")
export TOKEN_B=$(cast call "$FLASH_SWAP" 'tokenB()(address)' --rpc-url "$RPC_URL")
export POOL_A=$(cast call "$FLASH_SWAP" 'poolA()(address)' --rpc-url "$RPC_URL")
export POOL_B=$(cast call "$FLASH_SWAP" 'poolB()(address)' --rpc-url "$RPC_URL")
cast call "$TOKEN_A" 'balanceOf(address)(uint256)' "$POOL_A" --rpc-url "$RPC_URL"
cast call "$TOKEN_B" 'balanceOf(address)(uint256)' "$POOL_A" --rpc-url "$RPC_URL"
cast call "$TOKEN_A" 'balanceOf(address)(uint256)' "$POOL_B" --rpc-url "$RPC_URL"
cast call "$TOKEN_B" 'balanceOf(address)(uint256)' "$POOL_B" --rpc-url "$RPC_URL"
```

预期依次为 `10000 × 10^18`、`20000 × 10^18`、`10000 × 10^18`、`30000 × 10^18`。Pair 内部按地址排序为 token0/token1，不能默认 A 总是 token0。

现在报价并执行第一笔套利。`quote` 只读，返回“应还 B、预计得到 B”；执行脚本默认借 `100 A`、最低利润 `90 B`：

```bash
cast call "$FLASH_SWAP" 'quote(uint256)(uint256,uint256)' 100000000000000000000 --rpc-url "$RPC_URL"
forge script script/ExecuteFlashSwap.s.sol:ExecuteFlashSwap \
  --rpc-url "$RPC_URL" --sender "$ACCOUNT" --unlocked --broadcast \
  --gas-estimate-multiplier 200 -vvvv > "$LOG_DIR/execution-anvil.log" 2>&1
```

读取日志时检查命令退出码和回执，不能只看到模拟中的 `FlashSwapExecuted` 就算成功。首次跨区块兑换可能更新 V2 累积价格，gas 比同时间戳模拟多；本次实测默认估算余量不足，故执行命令保留 `200%` 余量。gas limit 是执行上限，不等于最终实际消耗。

每次套利都会改变价格，不要把这条命令当作可无限重复的演示。想改变数量可导出 `BORROW_A`、`MIN_PROFIT_B`，单位均为最小单位，见 [.env.example](.env.example)；不需要创建或覆盖 `.env`。预存币不是策略本金，误转入的币不会作为利润转出，本合约没有救援提款入口。

## 取得可核验的成功日志

以下命令可用于本地或 Sepolia，取决于当前 `RPC_URL` 和 `CHAIN_ID`。先要求执行记录中有一笔成功回执：

```bash
export EXEC_RUN="$LOG_DIR/broadcast/ExecuteFlashSwap.s.sol/$CHAIN_ID/run-latest.json"
jq -e '(.receipts | length == 1) and .receipts[0].status == "0x1"' "$EXEC_RUN"
export TX=$(jq -r '.receipts[0].transactionHash' "$EXEC_RUN")
cast receipt "$TX" --rpc-url "$RPC_URL" --json > "$LOG_DIR/receipt-$CHAIN_ID.json"
cast run "$TX" --rpc-url "$RPC_URL" > "$LOG_DIR/replay-$CHAIN_ID.log" 2>&1
cast call "$TOKEN_B" 'balanceOf(address)(uint256)' "$ACCOUNT" --rpc-url "$RPC_URL"
cast call "$TOKEN_A" 'balanceOf(address)(uint256)' "$FLASH_SWAP" --rpc-url "$RPC_URL"
cast call "$TOKEN_B" 'balanceOf(address)(uint256)' "$FLASH_SWAP" --rpc-url "$RPC_URL"
```

初始状态成功一次后，部署者应持有 `950093.519324040079252040 B`，套利合约 A/B 余额均为零。事件 `FlashSwapExecuted` 记录借款、所得、还款、利润；两份 Pair 的 `Swap` 与代币 `Transfer` 事件佐证资产路线。`cast run` 是读取历史状态进行本地回放，不会重发交易；若 RPC 无法提供历史状态，以真实成功回执和事件为准。

如果 Forge 中断或显示交易失败，先按日志里的交易哈希查询 `cast receipt`。部署由多笔交易组成，部分成功不会整体回滚；应核对已部署地址及 nonce，再考虑 `--resume`。不要重新运行部署脚本来“试试”。单笔闪电兑换回滚会恢复代币和池状态，但实际交易仍消耗 gas。

## Sepolia 部署与作业提交

准备好测试 ETH，在自己的终端中操作加密 keystore，密码不写入代码、聊天或命令参数。当前选用 `sepolia-deployer`。下列第一条命令会在本机提示解锁以获得公开地址；其后应确认地址、网络及费用预算。本地示例地址 `0xf39F…2266` 是私钥公开的 Anvil 默认账户，加密保存同一私钥也不能让它变成独占账户；若将它用于 Sepolia，任何人都可能支配账户资产及部署后的管理权限，只能用于不承载实际价值的测试。

```bash
cast wallet address --account sepolia-deployer
```

将下面地址占位值换为该命令返回的公开地址。公共 RPC 不含密钥；也可换成自己的 Sepolia RPC，不要提交带令牌的 URL：

```bash
export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export CHAIN_ID=11155111
export ACCOUNT=0x你的公开地址
export LOG_DIR=../output-tdd/flash-swap-26
mkdir -p "$LOG_DIR"
cast chain-id --rpc-url "$RPC_URL"
cast balance "$ACCOUNT" --ether --rpc-url "$RPC_URL"
cast gas-price --rpc-url "$RPC_URL"
forge script script/DeployFlashSwap.s.sol:DeployFlashSwap \
  --rpc-url "$RPC_URL" --sender "$ACCOUNT" -vv
```

网络必须是 `11155111`；最后一条只有模拟。核对模拟地址、gas 估算、账户资金和已授权费用范围后，才能实际签名广播。公共链不使用 `--unlocked`：

```bash
forge script script/DeployFlashSwap.s.sol:DeployFlashSwap \
  --rpc-url "$RPC_URL" --sender "$ACCOUNT" --account sepolia-deployer \
  --broadcast --gas-estimate-multiplier 200 -vv
```

执行前面“从实际广播记录提取地址”的整段命令；此时 `CHAIN_ID=11155111`，得到的是 Sepolia 地址。检查两池储备和报价，再执行套利：

```bash
forge script script/ExecuteFlashSwap.s.sol:ExecuteFlashSwap \
  --rpc-url "$RPC_URL" --sender "$ACCOUNT" --account sepolia-deployer \
  --broadcast --gas-estimate-multiplier 200 -vvvv
```

在自己的终端输入解锁密码，使用前一节的回执与回放命令保存最终证据；不要为了保存日志而把密码写进命令。控制台模拟输出不是实际成功回执的替代凭证。

作业提交两项：

- **代码库链接**：[flash-swap-26](https://github.com/woyaofei303/block-chain-list/tree/main/flash-swap-26)。提交作业时也可使用包含本题的固定提交链接，避免后续修改影响所引用版本。
- **Sepolia 成功日志**：上传 `receipt-11155111.json`、`replay-11155111.log`。写明两币、两个 Factory/Router、两池和策略地址，附 `https://sepolia.etherscan.io/tx/` 加上真实交易哈希，并说明借款、还款和利润。不要上传 `cache/`、keystore 或含凭据的 RPC 配置。

## 验证范围与限制

本次验证日期：2026-10-12，Foundry `1.8.1`。已完成：

- `forge fmt --check`、`forge build`；15 项测试全部通过，其中随机借款测试执行 256 组输入。
- 离线部署模拟；独立 Anvil 上 14 笔部署及加池交易成功；一次闪电兑换成功，实际消耗 `223826 gas`。
- 查询真实回执、回放交易，并逐项核对事件、两池余额与储备、部署者利润、策略零余额、LP、Factory/Router、代币供应量和用完的加池授权。
- 文档内 13 个 Bash 代码块通过语法检查，本地文档链接及自有函数 NatSpec 已检查。

首次本地广播曾因 gas 不足失败，查询失败回执并确认余额和报价未变后，才以 `--gas-estimate-multiplier 200` 重试。成功的本地交易哈希为：

```text
0xf2adf00ae972f434fe09a983011cc879c4a0b611421d151619bcf6b5943fc0a9
```

该哈希只属于本次 Anvil，不能在 Sepolia 浏览器查询。原始本地证据位于仓库的 `output-tdd/flash-swap-26/`：`verified-anvil.txt`、`receipt-anvil.json`、`execution-anvil.log`、`replay-anvil.log`；失败记录另存为带 `-failed` 后缀的文件。它们由 Git 忽略，节点停止后仍可查看文件，但不能再查询该临时链。

构建保留 7 条 lint 提示：1 条期限使用区块时间、2 条外部调用后发事件（其中一条是测试事件）、4 条有意忽略返回值（储备时间戳或测试用不到的报价）。本策略仅使用自己的普通 ERC20，Pair 自带锁；没有为消除提示而改动标准 V2 流程。Foundry 脚本还报告了依赖源码跟踪解析和临时 DeployHelper 产物提示，未阻止编译、部署或交易验证；25 号工程的既有 lint 提示保持原样。

Sepolia RPC 部署模拟也已通过：生成 14 笔待签名交易，没有链上回执。在本次模拟的费率和 200% gas 估算余量下，预计需要 `0.000059160358236876 ETH`。模拟日志保存于 `output-tdd/flash-swap-26/deploy-sepolia-simulation.log`；其中的合约地址只是预测地址，不能作为已部署证明。

**尚未完成：** Sepolia 广播及作业上传。用户已确认 `sepolia-deployer` 对应 `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`，并授权本次总 gas 支出不超过 `0.001` Sepolia 测试 ETH。本次只读查询余额为 `0.000000512180393081 ETH`，不足以完成部署；还需足额测试 ETH 和本机钱包解锁。费率、余额与账户 nonce 均会变化，广播前须重新核验。不应把本地或 RPC 模拟日志作为测试网成功交易提交。

本例人工建立价差，只适用于普通 ERC20、标准 V2 费率和固定 A → B 方向。合约仅允许部署者发起，最低利润与期限会阻止条件不符的执行；其他人仍可直接在公开池交易并消除价差。没有添加自动抢跑、路径搜索、无限授权、前端或通用资产托管功能。

# Uniswap V2：从部署到兑换，按调用流程跑一遍

本指南面向会基础 Solidity、第一次部署 Uniswap V2 的读者。你会完成一条主线：**部署合约并加池 → 用 100 A 换 B → 交还 LP、取回双币**。每一步都能对应到源码和余额变化。

先看 [调用流程文章](SOURCE_WALKTHROUGH.md)，再照下面操作。原题参考 [Learn-DeFi-Project / Swap](https://github.com/lbc-team/Learn-DeFi-Project/tree/Swap)；本工程完成合约部分，不需要前端或浏览器钱包。源码版本、许可证与修改范围见 [UPSTREAM.md](UPSTREAM.md)。

## 先记住这几个名字

- **Factory** 创建并记录池子，**Pair** 持有双币并发行 LP。
- **Router02** 是用户入口：计算数量、检查条件，再调用代币和 Pair。
- **A/B** 是本地示例 ERC20；**LP** 是代表池份额的另一种 ERC20，它的合约地址就是 Pair。
- **Anvil** 启动本地链，**Forge** 编译、测试和执行部署脚本，**Cast** 查询与发送交易。

本例三个代币的符号都沿用了 `UNI-V2`，请用合约地址区分。为了减少账户切换，同一个测试账户同时加池和兑换；这只是流程演示。

## 第 1 步：确认目录，先把测试跑通

需要 `forge`、`cast`、`anvil`、`jq`、`python3`。后两个工具只负责提取 JSON 和进行精确整数计算，不是合约依赖。下面以当前电脑的路径为例，其他电脑替换为自己的项目目录。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/uniswap-v2-25
forge --version
cast --version
anvil --version
jq --version
python3 --version
```

这些命令应显示版本；如果出现 `command not found`，先安装缺少的工具再继续。所有后续命令都从这个项目目录执行。

```bash
forge fmt --check
forge build
forge test -vv
```

预期是格式检查成功、编译成功、测试没有失败。上轮实际通过了 **19 项测试**，其中一个随机测试执行了 **256 组输入**。这一步只运行本地测试，不部署到 Anvil。

Core 使用 Solidity `0.5.16`，Router 使用 `0.6.6`，测试和脚本使用 `0.8.24`；首次运行时 Foundry 可能下载编译器。项目保留旧版实现，不要为了统一版本直接修改 pragma。

工程复用 `../foundry-counter-09/lib/forge-std`，因此需要完整仓库。若提示找不到 `forge-std`，先确认不是只下载了本项目子目录。

## 第 2 步：先模拟部署，再启动本地链

**目的：** 先确认脚本能完整执行，再进行本地广播。

```bash
forge script script/DeployUniswapV2.s.sol:DeployUniswapV2 \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 -vv
```

预期出现 `Script ran successfully` 和合约地址。这里没有连接 RPC，也没有发送链上交易；这些模拟地址先不用复制，之后以实际广播记录为准。

接下来开两个终端，**两个都进入第 1 步的项目目录**：终端 A 专门运行 Anvil，终端 B 运行剩余操作。两个终端的环境变量互不共享。

在终端 A 检查端口：

```bash
lsof -nP -iTCP:18545 -sTCP:LISTEN
```

没有输出表示没有查到监听进程；该命令此时可能返回退出码 1，属于正常情况。有输出则先确认是什么服务，不要终止未知进程或重复启动节点。

端口空闲时，在终端 A 执行：

```bash
anvil --host 127.0.0.1 --port 18545 --chain-id 31337 --silent
```

命令保持运行、没有启动日志是正常的，`--silent` 避免打印默认测试私钥。保持这个终端不动，切到终端 B。以下只使用这条本地链和它的公开解锁账户。

## 第 3 步：部署，并让脚本自动加入初始流动性

在终端 B 设置本地节点和账户，再确认网络：

```bash
export RPC_URL=http://127.0.0.1:18545
export ACCOUNT=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
cast chain-id --rpc-url "$RPC_URL"
```

预期输出 `31337`。`RPC_URL` 是请求发送到哪里；`ACCOUNT` 是由 Anvil 解锁的测试账户。chain ID 相同不代表同一个节点，因此也要确认 URL 仍是这里的本地地址。

```bash
forge script script/DeployUniswapV2.s.sol:DeployUniswapV2 \
  --rpc-url "$RPC_URL" --sender "$ACCOUNT" --unlocked --broadcast -vv
```

`--broadcast` 才会发送交易；`--unlocked` 让本地节点使用其解锁账户，不需要填写私钥。预期出现 `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`。

脚本中的实际调用顺序是：

```text
部署 Factory、WETH9、Router02、TokenA、TokenB
    ↓
分别授权 Router 使用 10000 A 和 20000 B
    ↓
Router.addLiquidity
    ├─ Factory.createPair → 部署并初始化 Pair
    ├─ A/B.transferFrom → 币从账户直接进入 Pair
    └─ Pair.mint → 账户得到 LP
```

共 8 笔交易。每个示例币发行 100 万枚，脚本把其中 `10000 A / 20000 B` 放进池。WETH 为 ETH 兑换入口准备，本次 A/B 主线不用它。

这一步只在新节点上执行一次。若广播中断，先检查回执：多笔交易并不整体回滚，前面成功的部署仍在，不能直接假设什么都没发生。

## 第 4 步：取出真实地址，检查资产放对了地方

下面从广播记录自动提取地址。`jq` 只是在 JSON 中找字段；先复制运行即可，不必把这些筛选语法当作 Uniswap 知识。

```bash
export RUN=../output-tdd/uniswap-v2-25/broadcast/DeployUniswapV2.s.sol/31337/run-latest.json
export FACTORY=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "UniswapV2Factory") | .contractAddress' "$RUN")
export WETH=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "WETH9") | .contractAddress' "$RUN")
export ROUTER=$(jq -r '.transactions[] | select(.transactionType == "CREATE" and .contractName == "UniswapV2Router02") | .contractAddress' "$RUN")
export TOKEN_A=$(jq -r '[.transactions[] | select(.transactionType == "CREATE" and .contractName == "ERC20")][0].contractAddress' "$RUN")
export TOKEN_B=$(jq -r '[.transactions[] | select(.transactionType == "CREATE" and .contractName == "ERC20")][1].contractAddress' "$RUN")
export PAIR=$(cast call "$FACTORY" 'getPair(address,address)(address)' "$TOKEN_A" "$TOKEN_B" --rpc-url "$RPC_URL")
```

Pair 是 Factory 在 `addLiquidity` 内部创建的，所以最后一行向 Factory 查询它。不要使用前面无 RPC 模拟输出的地址，模拟与真实链的 nonce 可能不同。

先检查 8 笔回执是否全部成功，再看池的余额与自己的 LP：

```bash
jq -e '(.receipts | length == 8) and all(.receipts[]; .status == "0x1")' "$RUN"
cast call "$TOKEN_A" 'balanceOf(address)(uint256)' "$PAIR" --rpc-url "$RPC_URL"
cast call "$TOKEN_B" 'balanceOf(address)(uint256)' "$PAIR" --rpc-url "$RPC_URL"
cast call "$PAIR" 'balanceOf(address)(uint256)' "$ACCOUNT" --rpc-url "$RPC_URL"
```

依次预期为 `true`、`10000000000000000000000`、`20000000000000000000000`、`14142135623730950487016`。Cast 可能同时显示科学计数法提示；比较前面的整数即可。

这些 ERC20 都有 18 位精度。下面把同一个 LP 数量转换成方便阅读的形式：

```bash
cast from-wei 14142135623730950487016
```

得到 `14142.135623730950487016`。这里借用工具的 18 位换算，不是说 LP 等于 ETH，也不能把该精度默认用于所有代币。

<details>
<summary>继续核验 Router、管理员和储备顺序</summary>

```bash
cast code "$PAIR" --rpc-url "$RPC_URL"
cast call "$ROUTER" 'factory()(address)' --rpc-url "$RPC_URL"
cast call "$ROUTER" 'WETH()(address)' --rpc-url "$RPC_URL"
cast call "$FACTORY" 'feeToSetter()(address)' --rpc-url "$RPC_URL"
cast call "$FACTORY" 'feeTo()(address)' --rpc-url "$RPC_URL"
cast call "$PAIR" 'token0()(address)' --rpc-url "$RPC_URL"
cast call "$PAIR" 'getReserves()(uint112,uint112,uint32)' --rpc-url "$RPC_URL"
```

Pair 的代码应非空；Router 的两个地址应与刚提取的 Factory/WETH 一致；管理员是 `ACCOUNT`，协议费接收地址默认是零地址。储备返回顺序是 `token0/token1`，由地址排序决定，不一定等于教程中的 A/B。

</details>

## 第 5 步：执行一次 100 A → B 的兑换

**先读源码：** [Router02](src/periphery/UniswapV2Router02.sol) 的 `swapExactTokensForTokens → _swap`，接着是 [Pair](src/core/UniswapV2Pair.sol) 的 `swap`。用户授权 Router，Router 调用代币转账，Pair 最终发出 B。

先记录 B 余额并查询输出。这里只读状态，不花费代币：

```bash
export AMOUNT_IN=$(cast to-wei 100)
export SWAP_PATH="[$TOKEN_A,$TOKEN_B]"
export B_BEFORE=$(cast call "$TOKEN_B" 'balanceOf(address)(uint256)' "$ACCOUNT" --rpc-url "$RPC_URL" --json | jq -r '.[0]')
export QUOTED_OUT=$(cast call "$ROUTER" 'getAmountsOut(uint256,address[])(uint256[])' "$AMOUNT_IN" "$SWAP_PATH" --rpc-url "$RPC_URL" --json | jq -r '.[0][1]')
cast from-wei "$QUOTED_OUT"
```

初始池第一次报价应为 `197.431606879412259770 B`。不是 200 B，因为兑换本身会改变池的比例，还包含 0.3% 交易费。详细的小数字推导见 [文章](SOURCE_WALKTHROUGH.md)。

把最低输出设为报价的 `99.5%`，允许最多低 `0.5%`；再设一个距当前区块时间 600 秒的截止时间。这个容忍度只用于本地示例，不是额外收费。

```bash
export MIN_OUT=$(python3 -c 'import os; print(int(os.environ["QUOTED_OUT"]) * 995 // 1000)')
export DEADLINE=$(( $(cast block latest --field timestamp --rpc-url "$RPC_URL") + 600 ))
```

接下来是两笔不同的交易：先 `approve`，再 Swap。加池时 A 的精确授权已经用完，因此需要重新授权；`approve` 本身只更新额度，不把钱转到 Router。

```bash
cast send "$TOKEN_A" 'approve(address,uint256)' "$ROUTER" "$AMOUNT_IN" \
  --from "$ACCOUNT" --unlocked --rpc-url "$RPC_URL"
cast send "$ROUTER" 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)' \
  "$AMOUNT_IN" "$MIN_OUT" "$SWAP_PATH" "$ACCOUNT" "$DEADLINE" \
  --from "$ACCOUNT" --unlocked --rpc-url "$RPC_URL"
```

检查两笔回执成功后，核对到账差额：

```bash
export B_AFTER=$(cast call "$TOKEN_B" 'balanceOf(address)(uint256)' "$ACCOUNT" --rpc-url "$RPC_URL" --json | jq -r '.[0]')
export B_GAIN=$(python3 -c 'import os; print(int(os.environ["B_AFTER"]) - int(os.environ["B_BEFORE"]))')
cast from-wei "$B_GAIN"
cast call "$PAIR" 'getReserves()(uint112,uint112,uint32)' --rpc-url "$RPC_URL"
```

在没有其他交易的新池中，差额应与上述报价相同；池中变为 `10100 A` 和 `19802.568393120587740230 B`。用户 LP 不变。再次兑换会用新的储备，不能继续期待完全相同的输出。

## 第 6 步：交还 LP，按份额取回双币

**对应源码：** `Router.removeLiquidity → Pair.transferFrom → Pair.burn`。这里要授权的是 Pair 地址上的 **LP 代币**，不是 A 或 B。

先读取自己的 LP、总 LP 和池当前余额，再按份额计算双币下限，仍留 0.5% 容忍度。Python 全程使用整数，避免金额变成浮点数后丢失精度。

```bash
export LP=$(cast call "$PAIR" 'balanceOf(address)(uint256)' "$ACCOUNT" --rpc-url "$RPC_URL" --json | jq -r '.[0]')
export SUPPLY=$(cast call "$PAIR" 'totalSupply()(uint256)' --rpc-url "$RPC_URL" --json | jq -r '.[0]')
export BALANCE_A=$(cast call "$TOKEN_A" 'balanceOf(address)(uint256)' "$PAIR" --rpc-url "$RPC_URL" --json | jq -r '.[0]')
export BALANCE_B=$(cast call "$TOKEN_B" 'balanceOf(address)(uint256)' "$PAIR" --rpc-url "$RPC_URL" --json | jq -r '.[0]')
export MIN_A=$(python3 -c 'import os; print(int(os.environ["BALANCE_A"]) * int(os.environ["LP"]) // int(os.environ["SUPPLY"]) * 995 // 1000)')
export MIN_B=$(python3 -c 'import os; print(int(os.environ["BALANCE_B"]) * int(os.environ["LP"]) // int(os.environ["SUPPLY"]) * 995 // 1000)')
export DEADLINE=$(( $(cast block latest --field timestamp --rpc-url "$RPC_URL") + 600 ))
```

这两个最小数量来自 `池余额 × 我的 LP ÷ 总 LP × 99.5%`，不是填写当初投入数量。其他人交易过后，池中的双币比例可能已经改变。

```bash
cast send "$PAIR" 'approve(address,uint256)' "$ROUTER" "$LP" \
  --from "$ACCOUNT" --unlocked --rpc-url "$RPC_URL"
cast send "$ROUTER" 'removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)' \
  "$TOKEN_A" "$TOKEN_B" "$LP" "$MIN_A" "$MIN_B" "$ACCOUNT" "$DEADLINE" \
  --from "$ACCOUNT" --unlocked --rpc-url "$RPC_URL"
cast call "$PAIR" 'balanceOf(address)(uint256)' "$ACCOUNT" --rpc-url "$RPC_URL"
cast call "$PAIR" 'totalSupply()(uint256)' --rpc-url "$RPC_URL"
cast call "$TOKEN_A" 'balanceOf(address)(uint256)' "$ACCOUNT" --rpc-url "$RPC_URL"
cast call "$TOKEN_B" 'balanceOf(address)(uint256)' "$ACCOUNT" --rpc-url "$RPC_URL"
```

预期用户 LP 为 `0`，总 LP 为 `1000` 个最小单位，A/B 已按份额回到用户账户。剩下的 LP 是首次永久锁定的部分，所以池中也会留下极少量双币。

完成后，在终端 A 按 Ctrl-C 停止自己启动的 Anvil。这个示例没有保存链状态；重启节点后，旧地址和旧回执不能证明合约仍存在。

## 卡住时，先按现象定位

- **连接被拒绝：** 确认终端 A 仍在运行，`RPC_URL` 是 `http://127.0.0.1:18545`。
- **地址变量为空或 `null`：** 确认当前目录、`RUN` 文件和实际广播是否成功；新开终端后要重新执行变量设置与地址提取。
- **`EXPIRED`：** 查询完到发送交易之间等太久；重新读取最新区块时间，生成 `DEADLINE` 再操作。
- **`transferFrom failed`：** 核对输入币余额及 `allowance(ACCOUNT, ROUTER)`。Swap 授权输入币，撤池授权 LP；授权必须已经成功。
- **`INSUFFICIENT_OUTPUT_AMOUNT`：** 当前报价低于自己设置的下限。重新报价并确认数量，不要为了让交易通过就直接把下限设为零。
- **Factory 有 Pair，但 Router 操作回滚：** 先核对 Factory 地址和两币地址，再运行哈希一致性测试；常见原因是修改源码后仍用了旧 `init_code_hash`。

失败后先看回执与链上状态。当前交易可以回滚，但此前已成功的独立授权、部署或兑换不会一起消失。

## 修改源码后再看：哈希维护

本工程已经填入正确的本地哈希；第一次按指南操作时不需要改它。只有修改 Pair、其依赖、注释、路径或编译配置后，才需要重新检查。

```text
0x7d0b5b3e4b9574ab8ad2c121c09ea744aa6aa2bc64800f628edacde6102eadaa
```

Factory 和 Router 必须用同一个“创建字节码指纹”才能得到同一个 Pair 地址。先完成修改和格式化，再计算：

```bash
forge fmt
forge build
forge inspect src/core/UniswapV2Pair.sol:UniswapV2Pair bytecode > ../output-tdd/uniswap-v2-25/pair-bytecode.hex
cast keccak "$(cat ../output-tdd/uniswap-v2-25/pair-bytecode.hex)"
```

将结果去掉 `0x`，替换 [UniswapV2Library.sol](src/periphery/libraries/UniswapV2Library.sol) 中 `pairFor` 的哈希字面量，再验证：

```bash
forge fmt
forge test --match-test testPairForMatchesActualCreationCode -vv
forge test -vv
```

这个测试调用真实 Library，并和 Factory 真正创建的地址比较；不能用另一个手写常量代替它。只改本文或文章，不会修改 Pair 的创建字节码。

<details>
<summary>工程配置、产物位置与源码入口</summary>

配置见 [foundry.toml](foundry.toml)：Istanbul、optimizer 开启、runs 为 `999999`。共享 forge-std 的宽范围 pragma 可能让 Foundry 额外编译兼容产物，不改变 Core、Router 和自有脚本固定的版本。

```text
src/core/         Factory、Pair、LP ERC20 与依赖
src/periphery/    Router02、接口和计算库
src/demo/         本地测试 ERC20 / WETH9
lib/uniswap-lib/  固定版本 TransferHelper 与许可证
test/            行为测试及跨版本 Library 入口
script/          部署和初始化脚本
```

具体实现见 [Factory](src/core/UniswapV2Factory.sol)、[Pair](src/core/UniswapV2Pair.sol)、[LP ERC20](src/core/UniswapV2ERC20.sol)、[Router02](src/periphery/UniswapV2Router02.sol)、[测试](test/UniswapV2.t.sol) 和 [部署脚本](script/DeployUniswapV2.s.sol)。

构建、缓存、广播和日志统一在仓库 `output-tdd/uniswap-v2-25/`。本机已忽略；从项目目录可检查：

```bash
git check-ignore ../output-tdd/uniswap-v2-25/out
```

新克隆仓库若未忽略，只需在仓库 `.git/info/exclude` 添加 `/output-tdd/`，不提交临时产物。

</details>

## 验证记录：2026-10-09 上轮实现阶段

以下记录来自上轮实现阶段。本轮仅重写文档，不重复部署或把旧结果标为新测。

环境：Foundry `1.8.1`，独立 `127.0.0.1:18545`，chain ID `31337`。

- `forge fmt --check`、`forge build`、19 项 `forge test` 成功；随机双向兑换 256 组通过。
- 原版 `init_code_hash` 导致地址一致性测试失败；替换本地哈希后通过。
- `forge script` 无 RPC 模拟成功；本地广播 8 笔交易回执全部 `status=0x1`。
- RPC 核验 Factory/Router/WETH 配置、部署字节码非空、初始双币余额和 LP 数量。
- RPC 实际 `100 A → 197.431606879412259770 B`，钱包余额变化与整数公式相等。
- RPC 赎回全部用户 LP，剩余总 LP 为 `1000`；池内 A/B 最小单位余额为 `715` / `1401`。
- 本次隔离节点在核验后停止，以下是历史本地地址，不是公共链或当前在线服务。

```text
Factory  0x5fbdb2315678afecb367f032d93f642f64180aa3
WETH9    0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
Router02 0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0
TokenA   0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9
TokenB   0xdc64a140aa3e981100a9beca4e685f962f0cf6c9
Pair     0xFd9F14c454F32e9c85B4F0b31524f387a4489BBE
```

原始证据在本地 `output-tdd/uniswap-v2-25/`：`tests.log`、`hash-before.log`、`simulation.log`、`deploy.log`、`verification.json` 和交易回执；默认不提交。

兼容性告警：Foundry 的 Solar 静态 lint 不完整支持旧版 Solidity，会报告无法解析 AST/源码、原版命名/导入、多版本 pragma 等提示；测试还触发忽略返回值、低级调用、ETH 测试和整数除法次序的 lint 提示。脚本输出包含本地环境没有 Etherscan 配置的提示。本次没有屏蔽这些日志，也没有宣称静态 lint 零告警；实际 solc 编译、EVM 测试和 RPC 回执均已核验。

尚未运行上游完整 Waffle 测试、主网 fork、安全审计和全部特殊代币兼容测试；没有公共链交易或前端。

## 作业链接

- [GitHub 代码与操作指南](https://github.com/woyaofei303/block-chain-list/tree/main/uniswap-v2-25)
- [源码解读文章](https://github.com/woyaofei303/block-chain-list/blob/main/uniswap-v2-25/SOURCE_WALKTHROUGH.md)

文章以 Markdown 随代码保存在仓库中，没有另行发布到博客或社区。

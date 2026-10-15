# 27 · 质押 ETH，按区块领取 KK

本项目实现题面 `IStaking` 的五个方法：`stake()`、`unstake(amount)`、`claim()`、`balanceOf(account)`、`earned(account)`。任何人都能存 ETH，非空池每经过一个区块累计分配 10 KK。基础版把 ETH 留在池内；加分版存入 Compound V2 的 cETH 市场，退出时一并取回对应的借贷收益。

这里的“质押”是把 ETH 存入练习合约，不是成为以太坊验证者。题面没有指定 KK 精度、空池奖励去向和借贷利息领取方式；本实现选择 KK 为 18 位精度、空池不补发、借贷利息随本金赎回。没有网页、管理员提款、升级入口或额外收费。

## 用两个人的存款走一遍

Alice 在区块 100 调用 `stake{value: 1 ether}()`。ETH 进入池，`balanceOf(Alice)` 和 `totalStaked` 都变成 1 ETH；刚存入尚未经过区块，待领 KK 为零。

到区块 110，Bob 调用 `stake{value: 3 ether}()`。合约先把前十个区块的 100 KK 记入全池累计收益，再把 Bob 的 3 ETH 加进本金。之前只有 Alice，100 KK 全部归她，Bob 不能追溯参与。

到区块 120，后十个区块又累计 100 KK。这一段 Alice 占 1/4，分到 25 KK；Bob 占 3/4，分到 75 KK。所以 `earned(Alice)` 为 125 KK，`earned(Bob)` 为 75 KK。

用户调用 `claim()` 时，池先更新收益，再把待领金额清零，最后调用 `KKToken.mint()` 铸到用户地址。KK 是按区块累计应领额，在领奖时才真正铸币；不需要每块有交易触发。部署脚本把 KK 的唯一 owner 权限交给池，原部署者随后不能直接铸币。

`unstake(amount)` 先按旧本金结算，再扣本金，最后把 ETH 返还用户。它不会自动领取 KK；全部退出后，旧奖励仍可通过 `claim()` 领取。接收方拒收 ETH 时整笔交易回滚，本金和奖励账本恢复；KK 铸币失败只影响领奖，不阻止退出 ETH。

## 累计收益为什么不用遍历所有用户

`rewardPerTokenStored` 表示“每 wei 本金从池运行以来累计分到多少 KK”，用 `1e27` 放大以减少整数除法误差。它是公共计数器，不是某个用户的余额。每个账户另存上次结算时的计数器快照。

```text
本段奖励 = (当前区块 - 上次结算区块) × 10 × 10^18
全池累计值 += 本段奖励 × 10^27 ÷ 本段总质押 wei
用户新增收益 = 用户原本金 wei × (全池累计值 - 用户旧快照) ÷ 10^27
用户待领 = 已结算但未领取的奖励 + 新增收益
```

每次存、退、领都先更新公共计数器，只结算当前操作的账户。其他用户下次操作时，用自己的旧快照补算即可；每次操作不随用户人数增加而循环。存取之前结算，是为了让旧本金参与旧区间、新本金只参与之后的区间。

- 使用 `block.number`，不使用秒数；同一区块内存入再取出没有 KK。
- 空池时累计值不增加；下一次有人存入会推进结算区块，跳过空池区间。
- `earned()` 是只读预估，不改变快照或代币供应。
- 整数除法向下取整，存在少量未铸造的 KK 尾差；频繁结算可累积尾差，不承诺小数无限精确，也不会把尾差补发给后来者。

## 加分项：把 ETH 存入 cETH

采用 Compound V2 的原生 ETH 市场，接口和地址核对自[官方 cToken 文档](https://docs.compound.finance/v2/ctokens/)、[CEther 源码](https://github.com/compound-finance/compound-protocol/blob/master/contracts/CEther.sol)和[主网部署记录](https://github.com/compound-finance/compound-protocol/blob/master/networks/mainnet.json)。文档页面抓取曾遇到站点跳转限制，方法签名进一步以官方源码和真实合约 fork 调用核对。

用户调用借贷版 `stake()` 后，调用关系是：

```text
用户 → CompoundStakingPool.stake() → cETH.mint{value: amount}()
用户 ETH → cETH 市场
新铸的 cETH → 质押池持有，数量记入该用户的 cTokenBalance
```

`mint()` 不返回状态码，失败直接回滚；不需要先授权原生 ETH。池用调用前后的 cETH 余额差记账，后存款的用户只能得到自己这次换到的份额。

例如 Alice 的 1 ETH 换到 50 cETH，之后 50 cETH 值 1.1 ETH。Bob 此时存入 1.1 ETH，也换到 50 cETH；两人各自持有 50 份，Alice 已有的 0.1 ETH 收益不会被分给 Bob。这个数字只是说明份额原理，不是当前市场报价。

借贷版 `unstake(amount)` 中的 amount 仍指**原始本金**。例如退出一半本金，就赎回该账户一半 cETH。池调用 `redeem(shares)`，要求返回值为零，再把本次实际收到的全部 ETH 交给用户。全退时取尽该用户的 cETH；多次存款合并记份额，部分退出按合并持仓比例计算。`balanceOf()` 始终查本金，`earned()` 始终查 KK，借贷利息不增加 KK 权重。

市场的 ETH 接收回调仅允许 cETH 地址调用，且使用 immutable 地址检查，兼容上游 2300 gas 的 `transfer`。市场赎回失败、可用流动性不足、用户拒收 ETH 都会令整笔 `unstake` 回滚，用户份额不会被扣掉。

## 代码阅读顺序与环境

1. [IStaking.sol](src/interfaces/IStaking.sol)：核对题面接口和单位。
2. [StakingPool.sol](src/StakingPool.sol)：从 `stake → _updateReward → rewardPerToken` 跟一次本金变动，再看 `unstake` 和 `claim`。
3. [KKToken.sol](src/KKToken.sol) 与 [Deploy.s.sol](script/Deploy.s.sol)：理解池如何获得唯一铸币权限。
4. [CompoundStakingPool.sol](src/CompoundStakingPool.sol)：基础流程不变，只重写 ETH 存入和赎回的两个步骤。
5. [基础测试](test/StakingPool.t.sol)、[借贷测试](test/CompoundStakingPool.t.sol)、[真实市场 fork 测试](test/CompoundFork.t.sol)：对照例子、舍入与失败回滚。

需要 `forge`、`cast`、`anvil`、`jq`。使用 Solidity 0.8.24、Shanghai、优化器 200 次；直接复用仓库 09 项目保存的 OpenZeppelin 5.7.0 和 forge-std 1.16.2。无需安装 Node 包，也无需重新下载库；只复制本目录到仓库外会失去依赖映射。

从仓库根目录进入项目，之后的命令都在该目录执行：

```bash
cd staking-pool-27
forge fmt --check
forge build
forge test -vv
```

默认无 `MAINNET_RPC_URL` 时，30 项离线测试运行，1 项 fork 测试明确显示跳过。若 shell 已设置该变量，测试也会尝试连接对应 RPC。运行真实市场验证需要能查询区块 `20000000` 历史状态的 Ethereum RPC：

```bash
MAINNET_RPC_URL=https://eth.drpc.org forge test --match-contract CompoundForkTest -vvvv
```

该测试在本地复制历史状态，存入 2 ETH、前进 100 个区块、全部赎回并领取 1000 KK。没有签名、钱包私钥或公共链交易。公共 RPC 可能限流或停止保留历史；出现 `pruned history unavailable` 时应换用支持此区块的归档 RPC，不能把跳过当作通过。

## 基础版本地完整操作

先运行部署模拟，不连接 RPC、不广播。显式使用零地址选择基础版，避免继承 shell 中其他 `CETH` 配置：

```bash
CETH=0x0000000000000000000000000000000000000000 \
forge script script/Deploy.s.sol:Deploy \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 -vv
```

终端 A 检查独立端口。没有输出表示没有查到监听者；有输出则先确认进程，不终止未知服务：

```bash
lsof -nP -iTCP:19645 -sTCP:LISTEN
```

端口空闲时启动本地链并保持运行。`--silent` 避免打印默认测试私钥：

```bash
anvil --host 127.0.0.1 --port 19645 --chain-id 31337 --silent
```

终端 B 进入同一项目目录，设置公开参数，检查 chain ID 应为 `31337`：

```bash
export RPC_URL=http://127.0.0.1:19645
export ALICE=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export BOB=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
export LOG_DIR=../output-tdd/staking-pool-27
mkdir -p "$LOG_DIR"
cast chain-id --rpc-url "$RPC_URL"
```

在新节点部署一次：创建 KK、创建池、把 KK owner 交给池，共 3 笔交易。本地节点已解锁公开测试账户，不需要读取私钥。不要把此命令的 RPC 换成公共网络：

```bash
CETH=0x0000000000000000000000000000000000000000 \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --sender "$ALICE" --unlocked --broadcast -vv
```

从这次广播记录提取地址，核对三个成功回执和铸币权限。离线模拟的地址不能用作广播地址：

```bash
export RUN="$LOG_DIR/broadcast/Deploy.s.sol/31337/run-latest.json"
jq -e '(.receipts | length == 3) and all(.receipts[]; .status == "0x1")' "$RUN"
export POOL=$(jq -r '.transactions[] | select(.contractName == "StakingPool" and .transactionType == "CREATE") | .contractAddress' "$RUN")
export KK=$(cast call "$POOL" 'rewardToken()(address)' --rpc-url "$RPC_URL")
cast call "$KK" 'owner()(address)' --rpc-url "$RPC_URL"
```

最后一行应返回池地址。Alice 先存 1 ETH，手动挖 9 个区块，Bob 的存款交易再占 1 块，两次存款相隔 10 块：

```bash
cast send "$POOL" 'stake()' --value 1ether --from "$ALICE" --unlocked --rpc-url "$RPC_URL"
cast rpc anvil_mine 0x9 --rpc-url "$RPC_URL"
cast send "$POOL" 'stake()' --value 3ether --from "$BOB" --unlocked --rpc-url "$RPC_URL"
cast rpc anvil_mine 0xa --rpc-url "$RPC_URL"
cast call "$POOL" 'earned(address)(uint256)' "$ALICE" --rpc-url "$RPC_URL"
cast call "$POOL" 'earned(address)(uint256)' "$BOB" --rpc-url "$RPC_URL"
```

两次查询预期分别为 `125000000000000000000` 和 `75000000000000000000`。查询不会挖块；每笔写交易会挖块，所以接下来的实际领取量会继续增长。

让 Alice 先全退并领奖，再让 Bob 全退并领奖。退 ETH 和领 KK 是两个独立方法：

```bash
cast send "$POOL" 'unstake(uint256)' 1000000000000000000 --from "$ALICE" --unlocked --rpc-url "$RPC_URL"
cast send "$POOL" 'claim()' --from "$ALICE" --unlocked --rpc-url "$RPC_URL"
cast send "$POOL" 'unstake(uint256)' 3000000000000000000 --from "$BOB" --unlocked --rpc-url "$RPC_URL"
cast send "$POOL" 'claim()' --from "$BOB" --unlocked --rpc-url "$RPC_URL"
cast call "$POOL" 'totalStaked()(uint256)' --rpc-url "$RPC_URL"
cast balance "$POOL" --rpc-url "$RPC_URL"
cast call "$KK" 'balanceOf(address)(uint256)' "$ALICE" --rpc-url "$RPC_URL"
cast call "$KK" 'balanceOf(address)(uint256)' "$BOB" --rpc-url "$RPC_URL"
```

在未插入其他写交易或手动挖块的情况下，最后四项依次为 `0`、`0`、`127500000000000000000`、`102499999999999999999`。Bob 的最后一个最小单位因整数除法舍去；两人共领 `230 KK - 1 个最小单位`。钱包 ETH 还会扣本地模拟 gas，所以不能直接要求钱包净余额完全恢复。

结束时在终端 A 按 Ctrl-C，只停止自己启动的 Anvil。节点状态随停止消失，回执文件还在；下次应使用新部署记录。

## 借贷版部署与边界

`Deploy.s.sol` 通过 `CETH` 选择借贷版，仍只允许本地 EVM 的 chain ID `31337`。普通空白 Anvil 没有真实 cETH，所以不能直接把主网地址填进去。下面读取同一个历史区块，只模拟借贷版部署；`--chain-id` 设置本地模拟上下文，**不要添加 `--broadcast`**，RPC 仍指向公共主网的只读数据源：

```bash
CETH=0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5 \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://eth.drpc.org --fork-block-number 20000000 \
  --chain-id 31337 --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 -vv
```

若自行启动了主网 fork 的 Anvil，也可以把 RPC 指向那个本地节点进行借贷版的本地部署，再从广播记录按 `CompoundStakingPool` 合约名取地址。

基础版返还原额本金；借贷版返还市场实际赎回额，受市场风险、流动性和 cETH 舍入影响，不保证随时取出或本金无损。过小金额可能换不到一个 cETH 最小单位，此时明确回滚。没有领取或分配额外 COMP 激励，也没有处理被强制转入的 ETH 或他人直接转入的 cETH；这些转入不会成为任何用户的本金。应通过 `stake()` 存款。

## 本次验证记录

验证日期：2026-10-14。工具：Foundry 1.8.1 / solc 0.8.24。

- 格式检查与编译通过。离线行为、边界、重入、回滚测试 30 项，其中 3 项随机测试各 256 组；真实 cETH fork 测试另有 1 项。
- 主网区块 `20000000` 的 fork：存入 `2 ETH`，取得 `9951992846` 个 cETH 最小单位；100 块后返还 `2000000026929327060 wei`，领取 `1000 KK`，cETH 和本金份额归零。只代表该历史状态，不证明当前市场仍可存入。
- 基础版部署脚本离线模拟、借贷版部署脚本历史 fork 模拟均通过；隔离 Anvil 的 3 笔部署交易、6 笔用户交易均成功。两人查询得到 125/75 KK，最终领取数量与上文一致，池内 ETH 和总本金归零。
- `forge build` 仍输出命名、测试常量等风格建议，以及测试转账、错误 selector 截取、未使用 fork ID、外部调用后事件等 lint 提示。逐项查看后，转账目标为测试部署实例、selector 截取用于核对重入错误、生产入口有 `nonReentrant` 且检查转账结果；这里不宣称静态 lint 零告警。脚本运行还出现 Foundry 的源码 trace 解析和 `foundry-pp/DeployHelper` 临时产物告警，实际执行及回执核验成功，未修改共享依赖或工具链。
- 未部署公共链，未进行独立安全审计，未验证当前主网市场状态。未提交或推送 Git。

原始日志和本地回执在仓库 `output-tdd/staking-pool-27/`：`test-final.log`、`fork-archive.log`、`simulation.log`、`simulation-compound.log`、`deploy-anvil.log`、`verified-anvil.json`。首个 RPC 不支持历史状态的失败保留在 `fork.log`。这些文件由 Git 忽略，不作为公共链交易证据。

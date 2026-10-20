# 30 · 用 Token 投票决定 Bank 怎样花钱

本题实现三个合约：可记录历史票权的 GTK、管理提案的 Gov，以及保存 ETH 的 Bank。Bank 的管理员在构造时就指定为 Gov，部署者没有直接提款权限。成员通过提案确定收款人和金额，投票通过后，Gov 调用 `Bank.withdraw(address,uint256)` 完成支付。

题目来源为本次“实现基于 Token 投票治理”练习。题面没有指定发行量、投票周期和通过门槛，下文数字是这个教学实现的固定选择。

## 一笔 2 ETH 支出怎样完成

假设 Bank 有 10 ETH，GTK 总量为 100 万枚。Alice 持有 60 万，Bob 持有 30 万，Carol 持有 9 万，Dave 持有 1 万。四人都先调用 `delegate(自己的地址)`，激活自己的投票权。

1. Alice 调用 `Gov.propose`，提交一个动作：目标是 Bank，调用数据是 `withdraw(收款人, 2 ether)`。动作中的 `value` 为 0，因为支出来自 Bank 已有余额，不需要把 ETH 先转给 Gov。提案创建不会立即提款。
2. Gov 记录一个未来区块作为快照。快照是“在那个区块结束时，各地址分别有多少已委托票权”的历史记录。提案所在区块为 B 时，快照是 B+1，B+2 才能开始投票。
3. Alice 投赞成，Bob 投反对，Carol 投弃权。计票结果分别是 60 万、30 万、9 万。投票按 Token 数量加权，不按钱包数量计算。
4. 快照后的 20 个区块用于投票，最后一个区块仍能投票。结束后，赞成加弃权为 69 万，达到 10 万的法定票数，且赞成多于反对，提案进入 `Succeeded`。
5. 任意地址都可调用 `Gov.execute`，但必须提供原提案的目标、金额、调用数据和描述哈希。Gov 先标记已执行，再调用 Bank。Bank 看见调用者是管理员 Gov，于是把 2 ETH 直接给收款人。结果为 Bank 8 ETH、收款人 2 ETH、Gov 0 ETH。

这里的 Bank 是 DAO 公共金库。向 Bank 转入 ETH 是捐入公共资金，不会获得个人可提余额，也不会自动获得 GTK。GTK 的所有权、投票权和 Bank 中的 ETH 是三种不同的东西。

## 票权和权限为什么这样处理

[GovToken.sol](src/GovToken.sol) 继承仓库已有的 OpenZeppelin `ERC20Votes`。部署时一次性把 1,000,000 GTK 发给初始持有人，精度为 18，不暴露后续增发或销毁入口。`ether` 在 Token 代码中只是 `10^18` 的整数单位，不代表发行了 ETH。

持币后需要主动委托。委托给自己时自己投票，委托给代表时由代表投票；委托不转移代币所有权。转账或改委托会更新当前票权，却不会改写已经结束区块的历史票权。Gov 使用提案快照区块的 `getPastVotes`，所以 Alice 投过票后把币转给 Bob，Bob 对本提案仍然只有原来的 30 万票。同一地址对同一提案也只能投一次。

[Gov.sol](src/Gov.sol) 复用 `Governor` 的状态与执行逻辑、`GovernorVotes` 的快照取票、`GovernorCountingSimple` 的计票，不另写一份治理状态机。固定规则如下：

- 提案门槛：前一个区块至少有 1 GTK 的已委托票权；当前块才获得或委托的票不能马上用于发提案。
- 提案延迟：1 区块；投票期：20 区块。
- 选项：`0` 反对、`1` 赞成、`2` 弃权。
- 法定票数：快照总供应量的 10%，本例为 100,000 GTK；只统计赞成加弃权。
- 通过条件：达到法定票数，且赞成票严格多于反对票。平票、只有弃权或无人投票均失败。
- 执行无需持币，也不需要提案人本人操作；执行者只能触发已通过的原动作，不能替换收款人、金额或描述。

[Bank.sol](src/Bank.sol) 的 `admin` 不可修改，没有额外 owner。提款校验管理员、接收地址、正数金额和余额；接收方拒收时整笔交易回滚。Gov 的执行标记也随之回滚，仍为 `Succeeded`，解决余额不足或接收方问题后，可以重试同一提案。批量提案中任意动作失败，之前的支付也会回滚。

本例没有时间锁：投票结束且通过后就能执行，也没有额外执行有效期。Gov 保留 OpenZeppelin 的通用动作接口，可以提交多个合约调用；Bank 的提款权限仍只属于 Gov。初始 Token 全在一个地址，该持有人在分发前能够单独控制治理。20 区块、10% 门槛和无时间锁均为教学选择，未按真实资金场景配置或审计。快照防止同块借入归还和转账重复计票，但不能阻止跨块借币或多数票控制。

## 先跑测试，再读代码

需要 `forge`、`cast`、`anvil` 和 `jq`。项目使用 Solidity 0.8.28、Cancun、优化器 200 次，复用 `../foundry-counter-09/lib` 中的 OpenZeppelin 5.7.0 和 forge-std 1.16.2。投票依赖中使用 `MCOPY`，因此不能沿用部分旧项目的 Solidity 0.8.24 / Shanghai 配置。无需安装 Node 包；单独复制本目录离开仓库后，需自行恢复依赖映射。

从仓库根目录进入本项目，后续命令均在此目录执行：

```bash
cd token-governance-30
forge fmt --check
forge build
forge test -vv
```

只运行题目要求的提案、投票、执行闭环：

```bash
forge test --match-test testProposalVoteAndExecute -vvvv
```

建议按 [GovToken](src/GovToken.sol) → [Gov](src/Gov.sol) → [Bank](src/Bank.sol) → [完整治理测试](test/Governance.t.sol) → [部署脚本](script/Deploy.s.sol) 阅读。测试通过真实合约的公共接口验证行为：

- [GovToken.t.sol](test/GovToken.t.sol)：固定发行、自我委托、零地址校验、随机转账前后的历史票权。
- [Governance.t.sol](test/Governance.t.sol)：完整提款、管理员权限、提案门槛、快照和截止块边界、重复提案与重复投票。
- 同一治理测试还覆盖转账与改委托后的快照、同块借入归还、未委托余额、法定票数、弃权、平票、反对多数、无人投票、参数篡改、重复执行、余额不足和拒收后的重试、批量原子性、收款回调重入，以及随机金额守恒。

## 本地模拟部署

以下只在 Forge 内部 EVM 模拟，不连接 RPC，也不发送公共链交易。发送者地址是 Anvil 默认公开测试地址，不需要私钥。

```bash
forge script script/Deploy.s.sol:Deploy \
  --chain-id 31337 \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  -vv
```

脚本依次部署 Token、Gov、Bank，检查 `Bank.admin == Gov`，并打印地址。它只允许 chain ID 31337；模拟输出中的地址不能直接当成下一节新 Anvil 的部署地址。

## 在独立 Anvil 上完整走一遍

这是本地链实际写入，会消耗模拟 ETH。只对自己启动的节点执行。先在终端 A 检查端口；如果已有监听进程，先确认归属，不要结束未知进程或直接覆盖已有状态。

```bash
lsof -nP -iTCP:19845 -sTCP:LISTEN
```

端口空闲时，在终端 A 启动节点。`--silent` 避免打印测试账户密钥：

```bash
anvil --host 127.0.0.1 --port 19845 --chain-id 31337 --hardfork cancun --silent
```

终端 B 从仓库根目录执行 `cd token-governance-30`，然后保持在同一终端依次执行下列命令，保留各步骤的变量。

### 部署并取得本次地址

```bash
RPC_URL=http://127.0.0.1:19845
ACCOUNTS=$(cast rpc eth_accounts --rpc-url "$RPC_URL")
ALICE=$(printf '%s' "$ACCOUNTS" | jq -r '.[0]')
BOB=$(printf '%s' "$ACCOUNTS" | jq -r '.[1]')
CAROL=$(printf '%s' "$ACCOUNTS" | jq -r '.[2]')
DAVE=$(printf '%s' "$ACCOUNTS" | jq -r '.[3]')
RECIPIENT=0x000000000000000000000000000000000000bEEF
cast chain-id --rpc-url "$RPC_URL"

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --sender "$ALICE" --unlocked --broadcast

RECORD=../output-tdd/token-governance-30/broadcast/Deploy.s.sol/31337/run-latest.json
TOKEN=$(jq -r '.transactions[] | select(.contractName == "GovToken") | .contractAddress' "$RECORD")
GOV=$(jq -r '.transactions[] | select(.contractName == "Gov") | .contractAddress' "$RECORD")
BANK=$(jq -r '.transactions[] | select(.contractName == "Bank") | .contractAddress' "$RECORD")
jq '.receipts[] | {transactionHash,status}' "$RECORD"
cast call "$BANK" 'admin()(address)' --rpc-url "$RPC_URL"
cast call "$GOV" 'token()(address)' --rpc-url "$RPC_URL"
cast call "$TOKEN" 'balanceOf(address)(uint256)' "$ALICE" --rpc-url "$RPC_URL"
```

预期 chain ID 为 31337，三笔部署回执 `status` 都为 `0x1`，管理员等于 `$GOV`，治理 Token 等于 `$TOKEN`，Alice 持有 `1000000000000000000000000` 最小单位，即 100 万 GTK。`--unlocked` 使用本地节点已解锁账户，不读私钥。后续 `cast send` 也应核对回执成功；不要在失败后继续下一步。

### 分币、激活票权、向 Bank 存入 ETH

```bash
cast send "$TOKEN" 'transfer(address,uint256)' "$BOB" 300000000000000000000000 \
  --from "$ALICE" --unlocked --rpc-url "$RPC_URL"
cast send "$TOKEN" 'transfer(address,uint256)' "$CAROL" 90000000000000000000000 \
  --from "$ALICE" --unlocked --rpc-url "$RPC_URL"
cast send "$TOKEN" 'transfer(address,uint256)' "$DAVE" 10000000000000000000000 \
  --from "$ALICE" --unlocked --rpc-url "$RPC_URL"

for actor in "$ALICE" "$BOB" "$CAROL" "$DAVE"; do
  cast send "$TOKEN" 'delegate(address)' "$actor" \
    --from "$actor" --unlocked --rpc-url "$RPC_URL"
done

cast send "$BANK" --value 10ether --from "$ALICE" --unlocked --rpc-url "$RPC_URL"
cast call "$TOKEN" 'getVotes(address)(uint256)' "$ALICE" --rpc-url "$RPC_URL"
cast balance "$BANK" --ether --rpc-url "$RPC_URL"
```

预期 Alice 的票权为 `600000000000000000000000`，Bank 余额为 10 ETH。后续提案查询都不改变链状态；`cast send` 才是写入交易。

### 发起支付提案

描述也是提案 ID 的组成部分，执行时必须使用同一份描述哈希。先在本地编码 Bank 的提款调用，再查询该动作对应的提案 ID：

```bash
DESCRIPTION='Pay 2 ETH for development'
DESCRIPTION_HASH=$(cast keccak "$DESCRIPTION")
CALLDATA=$(cast calldata 'withdraw(address,uint256)' "$RECIPIENT" 2000000000000000000)
TARGETS="[$BANK]"
VALUES='[0]'
CALLDATAS="[$CALLDATA]"
PROPOSAL_ID=$(cast call "$GOV" \
  'hashProposal(address[],uint256[],bytes[],bytes32)(uint256)' \
  "$TARGETS" "$VALUES" "$CALLDATAS" "$DESCRIPTION_HASH" \
  --rpc-url "$RPC_URL" --json | jq -r '.[0]')

cast send "$GOV" 'propose(address[],uint256[],bytes[],string)' \
  "$TARGETS" "$VALUES" "$CALLDATAS" "$DESCRIPTION" \
  --from "$ALICE" --unlocked --rpc-url "$RPC_URL"

cast call "$GOV" 'state(uint256)(uint8)' "$PROPOSAL_ID" --rpc-url "$RPC_URL"
cast call "$GOV" 'proposalSnapshot(uint256)(uint256)' "$PROPOSAL_ID" --rpc-url "$RPC_URL"
cast call "$GOV" 'proposalDeadline(uint256)(uint256)' "$PROPOSAL_ID" --rpc-url "$RPC_URL"
```

刚提交后的状态为 `0`，即 Pending。使用 `--json` 取得完整整数 ID，避免把终端显示的科学计数法注释一起放进变量。

### 投票，等待截止后执行

Anvil 默认按交易出块；下面手动挖两块越过快照，让状态进入 Active：

```bash
cast rpc anvil_mine 0x2 --rpc-url "$RPC_URL"
cast send "$GOV" 'castVote(uint256,uint8)' "$PROPOSAL_ID" 1 \
  --from "$ALICE" --unlocked --rpc-url "$RPC_URL"
cast send "$GOV" 'castVote(uint256,uint8)' "$PROPOSAL_ID" 0 \
  --from "$BOB" --unlocked --rpc-url "$RPC_URL"
cast send "$GOV" 'castVote(uint256,uint8)' "$PROPOSAL_ID" 2 \
  --from "$CAROL" --unlocked --rpc-url "$RPC_URL"
cast call "$GOV" 'proposalVotes(uint256)(uint256,uint256,uint256)' \
  "$PROPOSAL_ID" --rpc-url "$RPC_URL"
```

查询返回顺序为反对、赞成、弃权，对应 30 万、60 万、9 万 GTK 的最小单位。为避免猜测要等多少块，直接查询截止块，再推进到下一块：

```bash
DEADLINE=$(cast call "$GOV" 'proposalDeadline(uint256)(uint256)' "$PROPOSAL_ID" \
  --rpc-url "$RPC_URL" --json | jq -r '.[0]')
CURRENT=$(cast block-number --rpc-url "$RPC_URL")
if [ "$CURRENT" -le "$DEADLINE" ]; then
  cast rpc anvil_mine "$(cast to-hex "$((DEADLINE + 1 - CURRENT))")" --rpc-url "$RPC_URL"
fi
cast call "$GOV" 'state(uint256)(uint8)' "$PROPOSAL_ID" --rpc-url "$RPC_URL"

cast send "$GOV" 'execute(address[],uint256[],bytes[],bytes32)' \
  "$TARGETS" "$VALUES" "$CALLDATAS" "$DESCRIPTION_HASH" \
  --from "$DAVE" --unlocked --rpc-url "$RPC_URL"
```

执行前应为 `4`，即 Succeeded。Dave 没有参与本次投票，仍然能触发已经授权的动作。若状态为 `3`（Defeated），不能通过重试执行绕过投票结果。

### 核对资金和最终状态

```bash
cast call "$GOV" 'state(uint256)(uint8)' "$PROPOSAL_ID" --rpc-url "$RPC_URL"
cast balance "$BANK" --ether --rpc-url "$RPC_URL"
cast balance "$RECIPIENT" --ether --rpc-url "$RPC_URL"
cast balance "$GOV" --ether --rpc-url "$RPC_URL"
```

预期依次为 `7`（Executed）、8 ETH、2 ETH、0 ETH。重复执行会回滚，不能再次支付。结束后在终端 A 按 Ctrl-C，只停止自己启动的 Anvil；节点状态消失，下次请使用新的部署记录重新开始。

## 本次验证记录

2026-10-20，Foundry 1.8.1，本地 Forge EVM 与独立 Anvil（31337 / Cancun）：

- 30 项测试通过，0 失败、0 跳过；其中随机票权转账、随机治理提款各执行 256 组输入。
- `forge fmt --check`、`forge build` 成功，文档相对链接与 11 段 Shell 命令语法检查通过。
- 离线部署模拟成功；Anvil 的 3 笔部署与 13 笔用户交易全部核对成功回执。
- Anvil 提案最终为 Executed，Bank 8 ETH、接收人 2 ETH、Gov 0 ETH；已停止本轮启动的节点。
- `forge build` 保留不可变变量命名、重复测试常量等 lint 建议。此次 warning 均定位到测试文件：包括未使用返回值、已知 GTK 实现的转账返回值未逐个断言、测试金库充值、测试状态更新、故意不提供提款的接收合约，以及用于识别错误的 selector 截取。资金结果由余额、票权和回滚断言核对；此处不宣称 lint 零告警。
- `forge script` 出现 Foundry 源码 trace 解析与 `foundry-pp/DeployHelper` 临时产物提示；部署、脚本执行和回执检查成功。未修改共享库或绕过交易检查。

日志及本地回执在仓库的 `output-tdd/token-governance-30/`，包括 `test.log`、`build.log`、`simulation.log`、`deploy-anvil.log`、`verified-anvil.json`，由 Git 忽略。不将这些本地地址或回执作为公共链部署证明。

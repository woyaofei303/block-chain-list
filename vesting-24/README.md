# 24 · Vesting：代币到期后分月领取

假设团队答应给小明一笔代币，但希望他先等待一年，再分两年领取。本项目把总配额、受益人和时间规则写进合约，任何人都能触发领取，钱始终只给小明。

先理解 [07 的代币转账](../tokenbank-07/README.md)。Vesting 表示按时间逐步获得额度；Cliff 是开始释放前的等待期。本实现按整月跳变，不是每秒连续增加。

## 先用 24 枚算明白

把配额暂时想成 24 枚、每月 1 枚：前 12 个月全锁住；满 12 个月时只是结束等待，仍不能领；满 13 个月才能领第 1 枚；满 14 个月累计 2 枚；满 36 个月累计 24 枚。

如果第 13 个月没领，第 14 个月可一次领 2；若第 13 个月已经领 1，第 14 个月只能再领 1。已解锁总量与本次可领取量是两个数字。

本项目实际部署配额为 100 万枚，并约定一个教学月等于 30 天，不是自然日历月。下面给出精确规则、测试和本地时间推进操作。`vm.warp` / Anvil 时间修改只在模拟环境有效，不能让真实链提前解锁。

2026-10-09 已通过 15 项 Forge 测试，包含测试 EVM 中的解锁时间推进；未重跑独立部署演示。文末测试记录属于原实现阶段。

## 规则与接口

本实现按题面的“每月解锁 1/24”采用**整月分期**。教学约定一个月为 `30 days`，不是自然月；第 13 个月的首笔在部署后满 13 个教学月时解锁。

```text
部署时：       start = block.timestamp，转入 1,000,000 枚
满 12 个月：   0（Cliff 结束）
满 13 个月：   累计 1/24
满 13.5 个月： 累计仍为 1/24
满 24 个月：   累计 12/24，即 500,000 枚
满 36 个月：   累计 24/24，即 1,000,000 枚
```

累计解锁额为 `floor(totalAllocation × 已完成释放月数 / 24)`，每次实际领取额为累计解锁额减去 `released`。整数舍入发生在累计额度上，最后一期领取全部余款；错过某个月可之后一次领取，不会丢失额度。

```solidity
constructor(address beneficiary_, address token_, uint256 totalAllocation_);
function release() external;
function releasable() public view returns (uint256);
function vestedAmount(uint256 timestamp) public view returns (uint256);
```

- `beneficiary`、`token`、`totalAllocation`、`start` 部署后不可修改；`released` 记录累计付款。
- 任何人都能调用 `release()`，但资金只发给受益人；没有新增可领取额度时直接返回。
- 配额使用 ERC20 **最小单位**，合约不假定精度。示例代币为 18 位精度，因此 100 万枚是 `1_000_000 * 10**18`；若换成 6 位精度代币，应使用 `1_000_000 * 10**6`。
- 使用仓库已有 OpenZeppelin `SafeERC20` 处理转账，`Math.mulDiv` 避免比例计算的中间乘法溢出。先记账再转账，转账失败会回滚记账，重入不能重复领取。

## 代码阅读顺序

1. [项目规则](AGENTS.md) 与 [Foundry 配置](foundry.toml)。
2. [LinearVesting.sol](src/LinearVesting.sol)：固定配额、时间分期和安全释放。
3. [VestingToken.sol](src/VestingToken.sol)：本地示例 ERC20，向部署者铸造 200 万枚，其中 100 万枚用于本题锁仓，其余留在部署者账户。
4. [LinearVesting.t.sol](test/LinearVesting.t.sol)：使用 `vm.warp` 推进时间，验证 24 期、领取失败和重入。
5. [DeployVesting.s.sol](script/DeployVesting.s.sol)：依次部署代币、部署 Vesting、转入 100 万枚。

## 安装与测试

需要 Foundry（`forge`、`cast`、`anvil`）与 `jq`。使用 Solidity `0.8.24`、Shanghai；第三方依赖独立保存在本项目 `lib/`，可以单独复制本项目运行，无需 `forge install` 或 Node 包管理器。

```text
lib/forge-std/                 1.16.2，完整 src/ 与 Apache-2.0 / MIT 许可证
lib/openzeppelin-contracts/    5.7.0，完整 contracts/ 与 MIT 许可证
```

这两个固定源码副本来自仓库中已验证的对应版本，保留上游 README 与 `package.json` 版本信息；没有修改第三方代码。项目通过显式 remappings 只解析自己的 `lib/`，无符号链接、Git 子模块或兄弟目录依赖。上游开发测试、网站和发布工具不属于这些运行依赖。

从**仓库根目录**执行：

```bash
cd vesting-24
forge fmt --check
forge build
forge test -vv
```

测试无需 RPC。覆盖 Cliff 前/边界、首期前一秒与首期、月中不变、连续 24 期、漏领累计、任意调用者与固定收款人、重复领取、无效参数、额外注资、余额不足重试、ERC20 返回 false、重入与随机全范围配额/时间点。

构建、缓存、广播与本地日志统一存放于 `../output-tdd/vesting-24/`。该目录在本机已由 `.git/info/exclude` 忽略；新克隆仓库时也应确认它不进入暂存区。

## 本地 Anvil 部署与时间模拟

仅使用本地解锁测试账户，无需私钥或环境文件。以下时间修改命令只用于本次独立 Anvil。终端 A 从**项目目录**检查端口；有监听时先确认占用者，无监听则启动：

```bash
lsof -nP -iTCP:18554 -sTCP:LISTEN
anvil --host 127.0.0.1 --port 18554 --chain-id 31337 --silent
```

终端 B 从**仓库根目录**进入项目，取得公开地址并模拟脚本：

```bash
cd vesting-24
export VESTING_RPC_URL='http://127.0.0.1:18554'
export VESTING_SENDER="$(cast rpc eth_accounts --rpc-url "$VESTING_RPC_URL" | jq -r '.[0]')"
export VESTING_BENEFICIARY="$(cast rpc eth_accounts --rpc-url "$VESTING_RPC_URL" | jq -r '.[1]')"
test "$(cast chain-id --rpc-url "$VESTING_RPC_URL")" = 31337
forge script script/DeployVesting.s.sol:DeployVesting \
  --sig 'run(address)' "$VESTING_BENEFICIARY" \
  --rpc-url "$VESTING_RPC_URL" --sender "$VESTING_SENDER" -vv
```

以下命令仍在**项目目录、同一终端 B** 执行。确认模拟成功后广播到本地链；`--slow` 等待前一笔成功再发送下一笔：

```bash
forge script script/DeployVesting.s.sol:DeployVesting \
  --sig 'run(address)' "$VESTING_BENEFICIARY" \
  --rpc-url "$VESTING_RPC_URL" --sender "$VESTING_SENDER" \
  --unlocked --broadcast --slow -vv

export VESTING_RECORD='../output-tdd/vesting-24/broadcast/DeployVesting.s.sol/31337/run-latest.json'
export VESTING_ADDRESS="$(jq -r '.transactions[] | select(.contractName == "LinearVesting" and .transactionType == "CREATE") | .contractAddress' "$VESTING_RECORD")"
export VESTING_TOKEN="$(jq -r '.transactions[] | select(.contractName == "VestingToken" and .transactionType == "CREATE") | .contractAddress' "$VESTING_RECORD")"
jq -e '.receipts | length == 3 and all(.[]; .status == "0x1")' "$VESTING_RECORD"
cast code "$VESTING_ADDRESS" --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_ADDRESS" 'beneficiary()(address)' --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_ADDRESS" 'token()(address)' --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_TOKEN" 'balanceOf(address)(uint256)' "$VESTING_ADDRESS" --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_ADDRESS" 'releasable()(uint256)' --rpc-url "$VESTING_RPC_URL"
```

预期：3 笔交易回执全部成功，地址与构造参数一致，锁仓余额为 `1000000000000000000000000`，可领取额为 `0`。这是 3 笔顺序交易，不是原子部署；若中断，先检查回执及余额，不重复注资。

推进到满 12 个月，确认仍未产生首期额度：

```bash
export VESTING_START="$(cast call "$VESTING_ADDRESS" 'start()(uint256)' --rpc-url "$VESTING_RPC_URL" --json | jq -r '.[0]')"
cast rpc evm_setNextBlockTimestamp "$((VESTING_START + 12 * 30 * 86400))" --rpc-url "$VESTING_RPC_URL"
cast rpc evm_mine --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_ADDRESS" 'releasable()(uint256)' --rpc-url "$VESTING_RPC_URL"
```

推进到满 13 个月并领取；预期受益人余额与 `released` 都为 `41666666666666666666666` 最小单位：

```bash
cast rpc evm_setNextBlockTimestamp "$((VESTING_START + 13 * 30 * 86400))" --rpc-url "$VESTING_RPC_URL"
cast rpc evm_mine --rpc-url "$VESTING_RPC_URL"
cast send "$VESTING_ADDRESS" 'release()' --from "$VESTING_SENDER" --unlocked --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_ADDRESS" 'released()(uint256)' --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_TOKEN" 'balanceOf(address)(uint256)' "$VESTING_BENEFICIARY" --rpc-url "$VESTING_RPC_URL"
```

同月再调用 `release()` 不会新增付款。继续到满 24 个月，累计余额应为 `500000000000000000000000`：

```bash
cast rpc evm_setNextBlockTimestamp "$((VESTING_START + 24 * 30 * 86400))" --rpc-url "$VESTING_RPC_URL"
cast rpc evm_mine --rpc-url "$VESTING_RPC_URL"
cast send "$VESTING_ADDRESS" 'release()' --from "$VESTING_SENDER" --unlocked --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_TOKEN" 'balanceOf(address)(uint256)' "$VESTING_BENEFICIARY" --rpc-url "$VESTING_RPC_URL"
```

推进到满 36 个月，领取余款并核对锁仓清零：

```bash
cast rpc evm_setNextBlockTimestamp "$((VESTING_START + 36 * 30 * 86400))" --rpc-url "$VESTING_RPC_URL"
cast rpc evm_mine --rpc-url "$VESTING_RPC_URL"
cast send "$VESTING_ADDRESS" 'release()' --from "$VESTING_SENDER" --unlocked --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_TOKEN" 'balanceOf(address)(uint256)' "$VESTING_BENEFICIARY" --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_TOKEN" 'balanceOf(address)(uint256)' "$VESTING_ADDRESS" --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_ADDRESS" 'released()(uint256)' --rpc-url "$VESTING_RPC_URL"
cast call "$VESTING_ADDRESS" 'releasable()(uint256)' --rpc-url "$VESTING_RPC_URL"
```

预期依次为 `1000000000000000000000000`、`0`、`1000000000000000000000000`、`0`。结束后在终端 A 用 `Ctrl+C` 关闭自行启动的节点；重新启动未保存状态的节点后旧地址不再有效。

## 历史实测与实现限制

2026-10-08，Foundry `1.8.1`、Solidity `0.8.24`、独立 Anvil `31337`（端口 `18554`）：

- 格式检查、构建成功；15 项测试通过，随机测试 256 轮，0 失败。
- 改为独立 `lib/` 后重新通过构建与测试；把整个项目单独复制到隔离目录，无兄弟项目的目录结构，仍从零编译并通过 15 项测试。独立依赖下的部署脚本模拟也成功。
- “月中不解锁下一期”和“拒绝无代码代币地址”均观察到行为红测，再修正为通过。
- 部署脚本模拟及 3 笔本地交易成功；实测 100 万枚初始余额、12 个月/首期前一秒不可领取、13 个月首期、月中重复调用不变、24 个月半额、36 个月全额及余额归零。
- Foundry 对测试中的重复字面量、同文件测试夹具、循环外部调用、预期事件发出顺序等保留静态提示；这些路径仅为测试驱动，生产合约和部署脚本未出现对应警告。独立库下的脚本模拟成功，同时跟踪器提示无法解析 `lib/forge-std/src/StdError.sol` 的合约定义；未修改第三方源码来消除工具提示。原始证据在忽略目录 `output-tdd/vesting-24/`。

仅面向普通、无转账税、无 rebase 的 ERC20。合约部署即计时，晚注资不会延后计划；余额不足时 `release()` 会回滚。额外转入不增加固定配额，没有管理者、撤销或救援接口，超过配额或误转其他币的资产可能永久留在合约中。代币地址有代码不代表它是可信 ERC20。未执行公共链部署或 Git 推送。

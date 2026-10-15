# 28 · 每年缩减 1% 的 Rebase Token

本题实现一个初始发行 **1 亿枚**的 ERC20。每过一个完整年度，任何人都可以调用 `rebase()`，把总量缩减为上一年的 99%，所有持有人的余额同比变化，不需要逐个修改账户。

例如 Alice 持有 1000 RBT，期间没有转账：第一次年度通缩后，`balanceOf(alice)` 返回 `990 × 10^18`；第二年返回 `980.1 × 10^18`。总量依次是 1 亿、9900 万、9801 万枚。这里的 18 位精度只是记账单位，不是 ETH。

题目来源为本次「实现一个 rebase 型 Token」练习；转账、授权及事件接口参考 [ERC-20 标准](https://eips.ethereum.org/EIPS/eip-20)。实现选择如下：

- 名称 `Rebase Token`，符号 `RBT`，全部初始代币归部署者；没有管理员、额外增发、单独销毁或转账手续费。
- 一年固定为 `365 days`，从部署时开始计时，不按公历闰年计算。
- `rebase()` 不足一年时回滚，延迟调用则一次补齐所有完整年份；余额查询和转账不会自动触发通缩。
- 每年都执行整数计算 `supply * 99 / 100`，向下取整；不足一个最小单位的尾数舍弃。极长时间后总量会归零，此后余额为零，不会除零。

## 从 Alice 的余额理解内部份额

普通 ERC20 直接保存每个人有多少 Token。如果这样做，每次通缩就要找到所有持有人并改余额，用户越多，交易越贵，甚至无法执行。

本合约改为保存**内部份额**：可以把它理解为数量固定的细小记账单位。转账时份额从一个账户移到另一个账户；通缩时每份能换到的 Token 减少，份额本身不变。

核心关系是：

```text
INITIAL_SUPPLY = 100_000_000 × 10^18
TOTAL_SHARES = uint256 最大值减去它除以 INITIAL_SUPPLY 的余数
sharesPerUnit = floor(TOTAL_SHARES / totalSupply)
balanceOf(user) = floor(shares[user] / sharesPerUnit)
```

`sharesPerUnit` 表示一个 Token 最小单位需要多少内部份额。选择一个很大的固定份额总量，是为了减小整数换算的舍入影响；初始份额总量又能整除初始发行量，因此首次分配精确。

部署者调用 `transfer(alice, 1000 ether)` 时，OpenZeppelin 的 `transfer → _transfer → _update` 最终进入本合约的 `_update`。它先检查部署者的当前可见余额，再移动 `1000 × 10^18 × sharesPerUnit` 个份额，并发出 `Transfer` 事件。

一年后，Bob 也能调用 `rebase()`。合约将总量设为 9900 万枚，重新计算 `sharesPerUnit`；Alice 的份额没有变化，但再次查询就只显示 990 枚。这个过程只按漏掉的年份循环，成本不随持有人数量增加。

Alice 此时转给 Bob 90 枚，会按新比例移动份额：Alice 显示 900，Bob 显示 90。再通缩一年，两人的余额分别为 891 和 89.1。余额不足会整笔回滚；`transferFrom` 失败时，已扣的授权也会恢复。

父合约提供名称、精度、授权、公开转账入口和常规校验；本合约重写 `totalSupply`、`balanceOf`、`_update`，实际余额和总量都以份额账本为准。不能只改 `balanceOf`，否则转账仍会读取旧余额。

## 时间与舍入边界

若部署后两年半才首次调用，合约连续执行两次 99%，并将 `lastRebaseTime` 推进到第二周年，而非调用时刻。剩下半年继续保留，到第三周年即可再次通缩；同一时刻重复调用会回滚。

授权额度 `allowance` 使用 Token 最小单位，**不会随 rebase 缩放**。例如授权 1000 枚后余额缩到 990 枚，代理仍最多只能转走当前 990 枚，超额操作会回滚。

余额会向下取整，内部份额除法也有舍入，所以账户余额之和可能略小于 `totalSupply()`；任意小额或多次转账组合不应期待无限小数精度。转账本身按可见数量准确增减，未显示的份额尾数仍留在原账户。总量归零后不再恢复。

rebase 发出 `Rebased` 事件，不为每个账户伪造 `Transfer`。只累计转账事件的索引器无法还原实时余额，需要重新查询 `balanceOf()`；与只支持普通 ERC20 的池子集成前，也必须检查它如何处理余额变化。

## 代码与测试

按顺序阅读 [合约](src/RebaseToken.sol)、[测试](test/RebaseToken.t.sol)、[部署脚本](script/Deploy.s.sol)。项目需要 `forge`、`cast`、`anvil` 和 `jq`；使用 Solidity 0.8.24、Shanghai、优化器 200 次，复用仓库 `foundry-counter-09/lib` 中的 OpenZeppelin 与 forge-std，无需安装 Node 包或下载新库。只复制本目录会丢失依赖映射，应保留仓库目录结构。

从仓库根目录进入项目，后续命令都在项目目录执行：

```bash
cd rebase-token-28
forge fmt --check
forge build
forge test -vv
```

测试覆盖年度前后一秒、第二年复利、多年补算与半年余数、重复调用、多个用户的余额、通缩后转账、零额与自转账、授权、失败回滚、零地址、超大输入和最终归零；两项 fuzz 测试各运行 256 次，核对随机金额及逐年执行和补算的一致性。

Forge lint 扫描合约和部署脚本；`foundry.toml` 明确排除测试文件，因为用例有意伪造调用者、制造失败交易并循环调用，测试行为由断言检查。年度时间比较、完整年度取整和部署后精确余额断言的 lint 豁免在对应代码旁说明原因。

## 本地模拟、部署与余额核验

先运行纯本地 EVM 模拟，不连接 RPC，也不广播交易。部署者使用 Anvil 的公开测试地址，无需私钥：

```bash
forge script script/Deploy.s.sol:Deploy \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 -vv
```

终端 A 检查独立端口，无监听输出时再启动节点；已有进程时先确认用途，不终止未知服务：

```bash
lsof -nP -iTCP:19745 -sTCP:LISTEN
```

确认端口空闲后启动：

```bash
anvil --host 127.0.0.1 --port 19745 --chain-id 31337 --silent
```

`--silent` 避免打印测试私钥。终端 B 进入同一项目目录，设置公开参数并核对 chain ID 应为 `31337`：

```bash
export RPC_URL=http://127.0.0.1:19745
export DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export ALICE=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
export BOB=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
export LOG_DIR=../output-tdd/rebase-token-28
cast chain-id --rpc-url "$RPC_URL"
```

下面的 `--broadcast` 会向这个本机节点实际发送一笔部署交易，使用节点已解锁的账户。脚本只支持 chain ID 31337；不要将 RPC 换成公共链：

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" --unlocked --broadcast -vv
export RUN="$LOG_DIR/broadcast/Deploy.s.sol/31337/run-latest.json"
jq -e '(.receipts | length == 1) and all(.receipts[]; .status == "0x1")' "$RUN"
export TOKEN=$(jq -r '.transactions[] | select(.contractName == "RebaseToken" and .transactionType == "CREATE") | .contractAddress' "$RUN")
cast call "$TOKEN" 'totalSupply()(uint256)' --rpc-url "$RPC_URL"
cast call "$TOKEN" 'balanceOf(address)(uint256)' "$DEPLOYER" --rpc-url "$RPC_URL"
```

两次只读查询应都返回 `100000000000000000000000000`。给 Alice 转 1000 枚，再读取余额，应为 `1000000000000000000000`：

```bash
cast send "$TOKEN" 'transfer(address,uint256)' "$ALICE" 1000000000000000000000 \
  --from "$DEPLOYER" --unlocked --rpc-url "$RPC_URL"
cast call "$TOKEN" 'balanceOf(address)(uint256)' "$ALICE" --rpc-url "$RPC_URL"
```

从部署时间精确推进到第一周年。`evm_setNextBlockTimestamp` 只影响本地节点下一块的时间，随后 Bob 的 `rebase` 交易才真正改变代币账本：

```bash
export START=$(cast call "$TOKEN" 'lastRebaseTime()(uint256)' --rpc-url "$RPC_URL" --json | jq -r '.[0]')
cast rpc evm_setNextBlockTimestamp "$((START + 31536000))" --rpc-url "$RPC_URL"
cast send "$TOKEN" 'rebase()' --from "$BOB" --unlocked --rpc-url "$RPC_URL"
cast call "$TOKEN" 'totalSupply()(uint256)' --rpc-url "$RPC_URL"
cast call "$TOKEN" 'balanceOf(address)(uint256)' "$ALICE" --rpc-url "$RPC_URL"
```

总量应为 `99000000000000000000000000`，Alice 应为 `990000000000000000000`。现在 Alice 转给 Bob 90 枚，再推进到第二周年：

```bash
cast send "$TOKEN" 'transfer(address,uint256)' "$BOB" 90000000000000000000 \
  --from "$ALICE" --unlocked --rpc-url "$RPC_URL"
cast rpc evm_setNextBlockTimestamp "$((START + 2 * 31536000))" --rpc-url "$RPC_URL"
cast send "$TOKEN" 'rebase()' --from "$DEPLOYER" --unlocked --rpc-url "$RPC_URL"
cast call "$TOKEN" 'totalSupply()(uint256)' --rpc-url "$RPC_URL"
cast call "$TOKEN" 'balanceOf(address)(uint256)' "$ALICE" --rpc-url "$RPC_URL"
cast call "$TOKEN" 'balanceOf(address)(uint256)' "$BOB" --rpc-url "$RPC_URL"
```

预期依次为 `98010000000000000000000000`、`891000000000000000000`、`89100000000000000000`。完成后在终端 A 用 `Ctrl+C` 停止自己启动的节点；本例没有保存链状态，重启后需要重新部署并提取地址。

## 本次验证与 GitHub 状态

2026-10-15，Foundry 1.8.1 / Solidity 0.8.24 本地验证：16 项测试通过，0 失败、0 跳过，包含两项各 256 次的 fuzz；格式、构建、部署模拟和独立 Anvil 部署及上述余额核验通过。日志与回执保存在 Git 忽略的 `../output-tdd/rebase-token-28/`，不作为公共链交易证据。

GitHub 代码入口：[合约源码](https://github.com/woyaofei303/block-chain-list/blob/main/rebase-token-28/src/RebaseToken.sol)、[余额与通缩测试](https://github.com/woyaofei303/block-chain-list/blob/main/rebase-token-28/test/RebaseToken.t.sol)、[完整项目](https://github.com/woyaofei303/block-chain-list/tree/main/rebase-token-28)。

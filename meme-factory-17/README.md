# 最小代理 ERC20 Meme 铸币工厂

本项目根据本次练习题实现：发行者通过 `deployMeme` 创建 ERC20 最小代理，买家通过 `mintMeme` 按固定批量付费铸币；每笔费用的 1% 给项目方，剩余部分给发行者。包含完整 Foundry 配置、关键中文注释、行为测试和本次实测日志。

题目中的 `deployInscription` 按同一创建操作理解，对外接口统一使用题目要求的 `deployMeme`。

## 1. 先明确数量与价格

题面没有规定精度、舍入和最后不足一批时的处理，本项目采用以下规则：

- 固定名称为 `Meme Token`，`symbol` 由发行者指定，可以重复；合约地址才是代币的唯一标识。
- **`decimals() = 0`，所有代币数量都是整数枚，不乘 `1e18`。** 例如余额 `100` 就是 100 枚，不能转账 0.5 枚。
- `deployMeme` 的 `totalSupply` 表示最大发行量，存储为代币的 `maxSupply()`；ERC20 的 `totalSupply()` 表示当前已经铸出的数量，初始为 `0`。
- `perMint` 表示每次成功铸造的固定数量，必须大于零，且不能超过最大发行量。发行者没有预留份额，也不能直接调用代币的 `mint`。
- `price` 表示**每枚**价格，单位 wei；一次费用为 `perMint * price`，允许免费发行（`price = 0`）。创建时拒绝费用乘法溢出的参数。
- 买家必须精确支付，多付、少付都回滚。Gas 是另外支付给网络的费用，不参与 1% / 99% 分账。
- 平台收入为 `cost / 100`，向下取整；发行者获得 `cost - platformFee`，包括舍入余数。例如 101 wei 分成 1 + 100 wei；不足 100 wei 时平台收入为零。
- 不足一批时拒绝继续铸造，不缩减最后一批。例如上限 250、每次 100，最多发行 200。需要全部铸完时，让 `totalSupply` 能被 `perMint` 整除。
- 项目方是**部署工厂的调用者**，发行者是**调用 `deployMeme` 的调用者**；两个地址及发行参数均不可更改。
- 同一账户可以购买多次。“公平”在本练习中指每次数量和价格固定，不包含限购、防机器人或一人一次限制。

示例：

```text
symbol       = DOG
totalSupply  = 300 枚
perMint      = 100 枚
price        = 1,000,000,000 wei / 枚（1 gwei / 枚）

每次支付     = 100 × 1,000,000,000 = 100,000,000,000 wei
平台到账     =   1,000,000,000 wei
发行者到账   =  99,000,000,000 wei
买家获得     = 100 DOG
三次总发行量 = 300 DOG，第四次拒绝
```

## 2. 代码阅读顺序与代理原理

1. [AGENTS.md](AGENTS.md)：本项目的单位、验证命令与环境边界。
2. [foundry.toml](foundry.toml)：编译版本、现有依赖映射和产物路径。
3. [MemeToken.sol](src/MemeToken.sol)：从构造函数、`initialize`、元数据查询到 `mint` 阅读。
4. [MemeFactory.sol](src/MemeFactory.sol)：从构造函数、`deployMeme` 到 `mintMeme` 与 `_pay` 阅读。
5. [MemeFactory.t.sol](test/MemeFactory.t.sol)：先看分账、上限两项题面测试，再看代理、异常回滚和重入测试。

```text
项目方部署 MemeFactory
    └─ 创建一份 MemeToken implementation，锁定实现合约的初始化

发行者 → factory.deployMeme("DOG", 300, 100, 1 gwei)
    ├─ Clones.clone(implementation) → 45 字节运行时代码的 ERC-1167 代理
    ├─ 同一交易调用代理.initialize(...) → 设置代理自己的状态
    └─ issuerOf[代理地址] = 发行者，返回代理地址并发出 MemeDeployed

买家 → factory.mintMeme(代理地址)，附带 100 gwei
    ├─ 确认是本工厂创建的代币，并核对精确付款
    ├─ 代理.mint(买家) → delegatecall 到 implementation
    │   └─ 检查调用者是工厂、剩余额度够一批，更新代理中的供应量和余额
    ├─ 发送 1 gwei 给项目方、99 gwei 给发行者
    └─ 发出 MemeMinted；任一步失败，铸币和转账全部回滚
```

[ERC-1167](https://eips.ethereum.org/EIPS/eip-1167) 的核心是多个小代理共享固定实现地址，避免每次重复部署完整 ERC20 逻辑。本项目直接复用 [OpenZeppelin Clones](https://docs.openzeppelin.com/contracts/5.x/api/proxy#Clones)，不手写代理汇编。

`delegatecall` 使用代理自己的存储，所以 DOG 与 CAT 共享代码但不共享余额、符号或总供应量。代理目标不可升级。

**构造函数不等于代理初始化。** `MemeToken` 的构造函数只锁定实现合约。代理通过 `initializer` 只初始化一次；工厂把创建与初始化放在同一交易，避免留下可被抢先初始化的间隙。当前复用的普通 ERC20 构造函数仅设置名称和符号，因此本合约覆盖 `name()`、`symbol()`，在初始化时设置代理的符号，不依赖实现合约的构造存储。

安全路径：代币自身检查工厂身份和供应上限；工厂登记表拒绝外来代币；`nonReentrant` 阻止收款回调重入；先铸币更新状态、再分账，转账失败时利用 EVM 原子性撤销全部变化。

## 3. 环境与依赖

- Foundry：需要 `forge`；手动链上演练另需 `anvil`、`cast`。
- 本次实测 Foundry `1.8.1`，Solidity 固定 `0.8.24`，EVM `shanghai`，优化器 200 runs。
- 复用仓库已有 `foundry-counter-09/lib/openzeppelin-contracts`（包版本 `5.7.0`）与 `forge-std`（`v1.16.2`）源码。保留整个仓库结构，无需 `forge install`、npm、子模块初始化或新增依赖。
- 手动演练使用 Bash、`jq` 和 Python 3；Python 仅用于准确计算大整数余额差，避免浮点精度损失。
- 不需要 `.env`、公共 RPC 或钱包私钥。首次编译可能自动下载 Solidity 编译器。
- 测试中的 `dynamic_test_linking = false` 保留真实 `CREATE`，避免 Foundry 把 `new` 改为 cheatcode 后漏计部署 Gas。

若尚未安装 Foundry，按 [官方安装说明](https://getfoundry.sh/introduction/installation/) 准备环境。已安装时，从**仓库根目录**检查：

```bash
forge --version
cast --version
anvil --version
jq --version
python3 --version
```

## 4. 编译、测试与保存日志

以下命令均从**仓库根目录**执行；单元测试不需要启动 Anvil：

```bash
forge fmt --root meme-factory-17 --check
forge build --root meme-factory-17
forge test --root meme-factory-17 -vv
```

保存完整测试日志，`pipefail` 保证测试失败不会被 `tee` 掩盖：

```bash
mkdir -p output-tdd/meme-factory-17
set -o pipefail
forge test --root meme-factory-17 -vv 2>&1 | tee output-tdd/meme-factory-17/forge-test.log
```

查看题目两项核心要求的完整调用轨迹：

```bash
forge test --root meme-factory-17 --match-test 'test(MintPaysOnePercentToPlatformAndRemainderToIssuer|EveryMintHasFixedAmountAndCannotExceedTotalSupply)' -vvvv
```

查看部署 Gas 对比，或运行完整 Gas 报告：

```bash
forge test --root meme-factory-17 --match-test testCloneCreationUsesLessGasThanDeployingFullImplementation -vv
forge test --root meme-factory-17 --gas-report
```

本项目的 `out`、编译缓存和完整本地日志在 `output-tdd/meme-factory-17/`，默认忽略、不提交。下一节的日志摘要保留在本文，克隆仓库后也能阅读；完整日志可按上面的命令重新生成。

## 5. 本次测试记录

2026-09-27，Foundry `1.8.1`、Solidity `0.8.24`，格式检查与构建成功，本地 EVM 实测：**18 项测试通过，0 失败，0 跳过；其中一项模糊测试运行 256 组输入。** 以下为实际输出节选，省略耗时等非关键字段：

```text
[PASS] testCloneBytecodeMetadataAndStorageIsolation()
[PASS] testCloneCreationUsesLessGasThanDeployingFullImplementation()
Logs:
  clone creation + initialization gas: 233471
  full implementation deployment gas: 842231
  clone runtime bytes: 45
  full implementation runtime bytes: 3318

[PASS] testCloneSupportsErc20TransfersAndAllowances()
[PASS] testEveryMintHasFixedAmountAndCannotExceedTotalSupply()
Logs:
  supply after three mints: 300
  maximum supply: 300

[PASS] testFreeMintWorksEvenWhenBothRecipientsRejectEth()
[PASS] testFuzzFixedBatchesConserveFeesAndRespectCap(uint64,uint32,uint8,uint32) (runs: 256)
[PASS] testImplementationAndCloneCannotBeInitializedAgain()
[PASS] testIssuerCannotReenterMintDuringPayment()
[PASS] testIssuerRejectingEthRollsBackMintAndPlatformPayment()
[PASS] testMintPaysOnePercentToPlatformAndRemainderToIssuer()
Logs:
  minted tokens: 100
  platform received wei: 1000000000
  issuer received wei: 99000000000

[PASS] testOnlyFactoryCanMintEvenIssuerCannotBypassPayment()
[PASS] testPlatformCannotReenterMintDuringPayment()
[PASS] testPlatformRejectingEthRollsBackMintAndAllowsRetry()
[PASS] testRejectsInvalidDeploymentParameters()
[PASS] testRejectsUnregisteredTokensIncludingAnotherFactoryClone()
[PASS] testRemainingSupplySmallerThanBatchIsNotPartiallyMinted()
[PASS] testRoundingDustGoesToIssuerAndZeroFeeSkipsTransfer()
[PASS] testUnderpaymentAndOverpaymentRevertWithoutChangingState()

18 tests passed, 0 failed, 0 skipped (18 total tests)
```

Gas 对比使用同一编译设置：代理一侧包含创建、初始化、发行者登记与事件；完整实现一侧只部署代码，不含发行参数初始化。它是保守的本地参考基准，不是两笔完全相同业务交易的报价；一次性部署工厂和实现合约的费用未计入每次创建代理的费用。编译器、链规则、符号长度等变化会影响实际 Gas。

测试还验证了完整 45 字节代理代码中的实现地址、多个代币存储隔离、标准 ERC20 转账和授权、整数舍入、免费铸造、无效参数、少付/多付、外来代币、直接铸币权限、拒收 ETH 时全部回滚及恢复后重试。重入测试给攻击合约预先充值，并断言具体的重入错误，确保不是因为攻击账户没钱才失败。

`forge build` 仍输出启发式 lint 警告和风格建议，不是零警告构建。源码涉及外部调用后发事件、向收款地址发送 ETH：初始化目标是工厂固定创建的实现，铸造受重入锁保护，收款目标只来自固定平台地址与创建记录；这些路径已人工核对并通过对应测试。测试文件还会触发循环调用、模拟任意付款和按笔先取整再累加等提示；保留完整构建输出于 `output-tdd/meme-factory-17/forge-build.log`。

## 6. 命令行完整演练：部署 → 创建 → 铸造 → 验证分账

本节只连接独立本地 Anvil，使用节点解锁的模拟账户，不输入或打印私钥。示例端口为 `18557`；如果已占用，换一个空闲端口并同步 RPC，不能停止不明进程。

### 6.1 终端一：启动本地链

可在任意目录执行；`lsof` 无输出表示没有监听进程：

```bash
lsof -nP -iTCP:18557 -sTCP:LISTEN
```

```bash
anvil --host 127.0.0.1 --port 18557 --chain-id 31337 --quiet
```

保持终端运行。`--quiet` 隐藏包含测试账户密钥的启动信息。

### 6.2 终端二：选择角色

从**仓库根目录**开始，后续所有步骤在同一个 Bash 终端执行，保留变量：

```bash
bash
cd meme-factory-17
set -euo pipefail
MEME_RPC='http://127.0.0.1:18557'
test "$(cast chain-id --rpc-url "$MEME_RPC")" = 31337

MEME_ACCOUNTS=$(cast rpc eth_accounts --rpc-url "$MEME_RPC")
MEME_PLATFORM=$(printf '%s' "$MEME_ACCOUNTS" | jq -r '.[0]')
MEME_ISSUER=$(printf '%s' "$MEME_ACCOUNTS" | jq -r '.[1]')
MEME_BUYER=$(printf '%s' "$MEME_ACCOUNTS" | jq -r '.[2]')
mkdir -p ../output-tdd/meme-factory-17
```

第一个账户部署工厂并收平台费，第二个账户发行 Meme，第三个账户付款购买。这里读取的是公开地址。

### 6.3 项目方部署工厂

工厂没有构造参数，会自动创建一次实现合约。`--broadcast` 在这里仅发送到上述本地 Anvil：

```bash
forge create src/MemeFactory.sol:MemeFactory \
  --rpc-url "$MEME_RPC" --from "$MEME_PLATFORM" \
  --unlocked --broadcast --json \
  > ../output-tdd/meme-factory-17/deployment.json

MEME_FACTORY=$(jq -r '.deployedTo' ../output-tdd/meme-factory-17/deployment.json)
cast call "$MEME_FACTORY" 'projectOwner()(address)' --rpc-url "$MEME_RPC"
cast call "$MEME_FACTORY" 'implementation()(address)' --rpc-url "$MEME_RPC"
```

`projectOwner()` 应是 `MEME_PLATFORM`；`implementation()` 是共享模板地址，下一步使用的是工厂创建出的代理地址。

### 6.4 发行者创建 DOG 并获取真实代理地址

```bash
cast send "$MEME_FACTORY" 'deployMeme(string,uint256,uint256,uint256)' \
  'DOG' 300 100 1000000000 \
  --rpc-url "$MEME_RPC" --from "$MEME_ISSUER" --unlocked --json \
  > ../output-tdd/meme-factory-17/deploy-meme.json

MEME_EVENT=$(cast keccak 'MemeDeployed(address,address,string,uint256,uint256,uint256)')
MEME_TOPIC=$(jq -r --arg event "$MEME_EVENT" \
  '.logs[] | select(.topics[0] == $event) | .topics[1]' \
  ../output-tdd/meme-factory-17/deploy-meme.json)
MEME_TOKEN="0x${MEME_TOPIC: -40}"

cast call "$MEME_FACTORY" 'issuerOf(address)(address)' "$MEME_TOKEN" --rpc-url "$MEME_RPC"
cast call "$MEME_TOKEN" 'symbol()(string)' --rpc-url "$MEME_RPC"
cast call "$MEME_TOKEN" 'decimals()(uint8)' --rpc-url "$MEME_RPC"
cast call "$MEME_TOKEN" 'maxSupply()(uint256)' --rpc-url "$MEME_RPC"
cast call "$MEME_TOKEN" 'totalSupply()(uint256)' --rpc-url "$MEME_RPC"
```

预期依次得到发行者地址、`DOG`、`0`、`300`、`0`。状态交易的函数返回值不会直接出现在普通交易回执中，因此从 `MemeDeployed` 的第一个 indexed 参数提取代理地址；不要用另一次 `cast call deployMeme` 的模拟地址代替它。

### 6.5 买家付费铸造，并核对实际到账

在发行者创建交易之后记录基线，避免把部署 Gas 算进分成变化：

```bash
MEME_PLATFORM_BEFORE=$(cast balance "$MEME_PLATFORM" --rpc-url "$MEME_RPC")
MEME_ISSUER_BEFORE=$(cast balance "$MEME_ISSUER" --rpc-url "$MEME_RPC")

cast send "$MEME_FACTORY" 'mintMeme(address)' "$MEME_TOKEN" \
  --value 100000000000 \
  --rpc-url "$MEME_RPC" --from "$MEME_BUYER" --unlocked --json \
  > ../output-tdd/meme-factory-17/mint-1.json

MEME_PLATFORM_AFTER=$(cast balance "$MEME_PLATFORM" --rpc-url "$MEME_RPC")
MEME_ISSUER_AFTER=$(cast balance "$MEME_ISSUER" --rpc-url "$MEME_RPC")

python3 - "$MEME_PLATFORM_BEFORE" "$MEME_PLATFORM_AFTER" "$MEME_ISSUER_BEFORE" "$MEME_ISSUER_AFTER" <<'PY'
import sys
platform_before, platform_after, issuer_before, issuer_after = map(int, sys.argv[1:])
assert platform_after - platform_before == 1_000_000_000
assert issuer_after - issuer_before == 99_000_000_000
print('Platform received wei:', platform_after - platform_before)
print('Issuer received wei:', issuer_after - issuer_before)
PY

cast call "$MEME_TOKEN" 'balanceOf(address)(uint256)' "$MEME_BUYER" --rpc-url "$MEME_RPC"
cast call "$MEME_TOKEN" 'totalSupply()(uint256)' --rpc-url "$MEME_RPC"
cast balance "$MEME_FACTORY" --rpc-url "$MEME_RPC"
```

预期买家余额和当前供应量均为 `100`，工厂 ETH 余额为 `0`。本笔 Gas 由买家支付，因此平台、发行者余额增量可直接验证分账；买家的 ETH 减少量还包含 Gas。

### 6.6 铸满后验证不能超发

```bash
for MEME_BATCH in 2 3; do
  cast send "$MEME_FACTORY" 'mintMeme(address)' "$MEME_TOKEN" \
    --value 100000000000 \
    --rpc-url "$MEME_RPC" --from "$MEME_BUYER" --unlocked --json \
    > "../output-tdd/meme-factory-17/mint-${MEME_BATCH}.json"
done

cast call "$MEME_TOKEN" 'totalSupply()(uint256)' --rpc-url "$MEME_RPC"

if cast call "$MEME_FACTORY" 'mintMeme(address)' "$MEME_TOKEN" \
  --value 100000000000 --from "$MEME_BUYER" --rpc-url "$MEME_RPC" \
  > ../output-tdd/meme-factory-17/sold-out.log 2>&1; then
  printf '错误：超发调用竟然成功\n'
  exit 1
else
  cat ../output-tdd/meme-factory-17/sold-out.log
fi
```

当前供应量应为 `300`，最后的只读模拟应返回 `Supply cap reached`。`cast call` 不广播第四笔交易、不花 Gas；真正的失败交易回滚语义已由 Forge 测试验证。

同日独立 Anvil（`127.0.0.1:18557`、chain ID `31337`）的实际输出：

```text
Platform received wei: 1000000000
Issuer received wei: 99000000000
Buyer token balance: 100
Token decimals: 0
Factory balance wei: 0
Total supply after three mints: 300
Error: execution reverted: Supply cap reached
```

完成后，在终端一按 `Ctrl+C` 停止自己启动的 Anvil。本次验证节点已停止；重新启动默认是新链，需重新部署，不复用旧地址。

## 7. 常见问题与范围

- `Empty symbol`：代号不能为空。
- `Invalid supply`：必须满足 `0 < perMint <= totalSupply`。
- `Mint cost overflow`：`perMint * price` 超出 `uint256`，创建被拒绝。
- `Unknown meme`：传入了实现地址、其他工厂的代币、错误链上的地址或普通账户；请从本次创建事件读取代理地址。
- `Incorrect payment`：`msg.value` 必须精确等于每次数量乘单价，`--value` 的裸整数是 wei。
- `Supply cap reached`：已经售罄，或剩余额度不足一批。
- `Only factory`：必须调用工厂的 `mintMeme`，不能直接调用代币的 `mint`。
- `InvalidInitialization`：实现合约已锁定，或代理已经初始化。
- `Fee transfer failed`：某个收款合约拒绝接收 ETH；本次 token、费用全部回滚。收款方恢复接收后才可重试。
- `ReentrancyGuardReentrantCall`：收款回调尝试嵌套进入 `mintMeme`。

这是固定规则的教学工厂：没有升级、价格修改、管理员增发、提现队列、退款入口或前端。按题意即时分账，因此拒收非零 ETH 的发行者会使自己的 Meme 无法铸造；拒收的平台会影响所有需要支付平台费的 Meme。合约收款地址应能正常接收 ETH。正常铸造不会在工厂留下费用；没有针对强制转入 ETH 的救援接口。

本次仅在本地 EVM / Anvil 验证，没有公共链部署、真实资金操作或课程平台提交。仓库现有 Foundry CI 只覆盖第 09 个项目，本项目以本文命令单独验证。

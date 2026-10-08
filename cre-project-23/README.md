# TokenBank + Chainlink CRE 自动半额划转

用户先 `approve`，再调用 `deposit(amount)`。CRE Cron 每 5 分钟读取银行状态；当 `totalDeposits > threshold` 时生成报告，由 Forwarder 调用 `TokenBankReceiver.onReport`，再调用 `TokenBank.withdrawhalf(recipient)`。

本次实际运行记录见 [RUN_LOG.md](RUN_LOG.md)，包含本地链上的余额与交易哈希。代码入口为 [GitHub · cre-project-23](https://github.com/woyaofei303/block-chain-list/tree/main/cre-project-23) 和 [GitHub · TokenBank](https://github.com/woyaofei303/block-chain-list/blob/main/tokenbank-07/contracts/TokenBank.sol)。运行日志记录的是验证当时的状态，发布版本以 Git 提交历史为准。

## 实现口径与阅读顺序

1. [TokenBank.sol](../tokenbank-07/contracts/TokenBank.sol)：保留 `deposit(amount)` / `withdraw(amount)`，新增 `totalDeposits`、owner 配置的 `automationReceiver` 和 `withdrawhalf(recipient)`。
2. [TokenBankReceiver.sol](contracts/evm/src/TokenBankReceiver.sol)：收款人、阈值和可信 Forwarder 在部署时固定；`getState()` 一次返回金额、阈值、收款人和 `nextNonce`。
3. [workflow.ts](my-workflow/workflow.ts)：Cron 读取 finalized 状态；严格超阈值才写报告，报告内容为 `abi.encode(uint256 nonce)`。
4. [合约测试](contracts/test/TokenBankReceiver.t.sol)、[工作流测试](my-workflow/workflow.test.ts)、[本地集成测试](my-workflow/integration.test.ts)。

金额均为 Token 最小单位；示例 BaseERC20 是 18 位精度。`threshold=100000000000000000000` 表示 100 枚，仅在大于 100 时执行。阈值可在部署时自定义，更换阈值或收款人需要重新部署 Receiver 并由银行 owner 重新绑定。

**自动转出的部分会减少每位存款人的可提余额。** 例如总存款 120 转出 60 后，用户合计只能再提 60。半额分摊按用户余额计算，奇数舍入误差不超过一个最小单位，总扣账严格等于 `floor(totalDeposits / 2)`。这属于本题的资金归集语义，不能将原始存款额继续展示为可提余额。

直接 `transfer` 到银行的 Token 不计入 `totalDeposits`，也不会由半额入口转出。教学版只支持无手续费、无 rebase、返回 bool 的标准 Token。为限制 O(n) 扫描 gas，最多接收 100 个历史存款地址；已有用户可继续存取。大规模场景应改用份额记账。

Receiver 写入前重新检查当前阈值和报告序号。成功后序号递增；重复报告拒绝，转币失败则序号与余额一起回滚。finalized 状态可能落后于最新交易，期间旧序号报告会被链上拒绝，不会重复划款。银行 owner 也可直接手动调用 `withdrawhalf`，该管理员操作不走 CRE 阈值检查。

## 安装与检查

从**仓库根目录**执行，需要 Foundry、Bun。项目沿用 Bun 锁文件；OpenZeppelin 复用仓库已有 `foundry-counter-09/lib`，无需另行下载。

```bash
bun install --cwd cre-project-23/my-workflow --frozen-lockfile --ignore-scripts
forge fmt --check --root cre-project-23/contracts
forge build --root cre-project-23/contracts
forge test --root cre-project-23/contracts
bun run --cwd cre-project-23/my-workflow typecheck
bun run --cwd cre-project-23/my-workflow test
bun run --cwd cre-project-23/my-workflow test:integration
```

集成测试自动选择空闲端口，部署独立 Anvil 本地链，并在结束时关闭自己的节点。它执行真实的 CRE 回调及合约读写；DON 共识/签名由 SDK 测试 runtime 替代。它不是公共链部署或已激活的定时任务。

格式/lint 复用共享 Web 项目已安装的 Biome，`bun run --cwd cre-project-23/my-workflow check`。共享 pre-commit 已接入本项目格式、类型与行为检查。`tsconfig.json` 覆盖工作流及单测；`tsconfig.integration.json` 单独检查需要 Node 进程/文件 API 的本地测试，生产工作流仍接受 CRE WASM 限制检查。

编译真实 CRE WASM，从 **`cre-project-23/my-workflow`** 执行：

```bash
./node_modules/.bin/cre-compile main.ts ../../output-tdd/tokenbank-cre/workflow.wasm
```

## 本地部署与手动复现

终端 A，从**仓库根目录**启动自己的独立节点；若端口被占用，请统一更换后续命令中的端口。

```bash
anvil --host 127.0.0.1 --port 18545 --chain-id 31337 --silent
```

终端 B，从**仓库根目录**执行。下面三个地址是 Anvil 的公开测试账户地址，使用节点解锁账户，不需要提供私钥：

```bash
export RPC_URL=http://127.0.0.1:18545
export DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export FORWARDER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
export RECIPIENT=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

forge script cre-project-23/contracts/script/DeployLocal.s.sol:DeployLocalScript \
  --root cre-project-23/contracts --sig 'run(address,address)' "$FORWARDER" "$RECIPIENT" \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" --unlocked

forge script cre-project-23/contracts/script/DeployLocal.s.sol:DeployLocalScript \
  --root cre-project-23/contracts --sig 'run(address,address)' "$FORWARDER" "$RECIPIENT" \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" --unlocked --broadcast

export TOKEN=$(jq -r '.transactions[] | select(.contractName == "BaseERC20") | .contractAddress' output-tdd/tokenbank-cre/broadcast/DeployLocal.s.sol/31337/run-latest.json)
export BANK=$(jq -r '.transactions[] | select(.contractName == "TokenBank") | .contractAddress' output-tdd/tokenbank-cre/broadcast/DeployLocal.s.sol/31337/run-latest.json)
export RECEIVER=$(jq -r '.transactions[] | select(.contractName == "TokenBankReceiver") | .contractAddress' output-tdd/tokenbank-cre/broadcast/DeployLocal.s.sol/31337/run-latest.json)

cast call "$BANK" 'token()(address)' --rpc-url "$RPC_URL"
cast call "$TOKEN" 'decimals()(uint8)' --rpc-url "$RPC_URL"
cast send "$TOKEN" 'approve(address,uint256)' "$BANK" 120000000000000000000 --rpc-url "$RPC_URL" --from "$DEPLOYER" --unlocked
cast send "$BANK" 'deposit(uint256)' 120000000000000000000 --rpc-url "$RPC_URL" --from "$DEPLOYER" --unlocked
cast call "$RECEIVER" 'getState()(uint256,uint256,address,uint256)' --rpc-url "$RPC_URL"

export REPORT=$(cast abi-encode 'f(uint256)' 1)
cast send "$RECEIVER" 'onReport(bytes,bytes)' 0x "$REPORT" --rpc-url "$RPC_URL" --from "$FORWARDER" --unlocked
cast call "$TOKEN" 'balanceOf(address)(uint256)' "$RECIPIENT" --rpc-url "$RPC_URL"
cast call "$BANK" 'balances(address)(uint256)' "$DEPLOYER" --rpc-url "$RPC_URL"
cast call "$BANK" 'totalDeposits()(uint256)' --rpc-url "$RPC_URL"
```

最后三次查询预期都是 `60000000000000000000`。再次发送相同 REPORT 应回滚 `Stale report`；用户可 `withdraw(60000000000000000000)` 取回剩余存款。这段手动示范中的 Forwarder 是本地解锁账户，不验证 DON 签名。运行结束后在终端 A 按 Ctrl-C 关闭自己的节点。

## Sepolia CRE 配置与上线边界

现有 `config.staging.json` / `config.production.json` 均为地址占位符，必须替换为本题 Receiver，不能复用旧 KeeperConsumer 地址。`project.yaml` staging RPC 指向 Sepolia；schedule 默认 `0 */5 * * * *`。生产 target 在本练习中也仅允许 Sepolia。

CRE 的生产 KeystoneForwarder 与模拟 MockForwarder 不同；必须从官方 [Forwarder Directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory) 核对当前网络地址。[Consumer 指南](https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/building-consumer-contracts) 说明 CLI 模拟不提供生产 workflow metadata，因此不要把模拟 Receiver 配置当作生产鉴权。

正式 Receiver 部署入口为 [DeployTokenBankReceiver.s.sol](contracts/script/DeployTokenBankReceiver.s.sol)，参数依次为银行、Forwarder、收款人、最小单位阈值、workflow ID。脚本在本地链外要求非零 workflow ID，并在绑定到银行之前设置元数据鉴权。银行必须是本次新编译部署的 TokenBank；旧合约实例不会因源代码修改而升级。

从**仓库根目录**，已自行配置公开参数及加密 keystore 后模拟部署：

```bash
forge script cre-project-23/contracts/script/DeployTokenBankReceiver.s.sol:DeployTokenBankReceiverScript \
  --root cre-project-23/contracts --sig 'run(address,address,address,uint256,bytes32)' \
  "$BANK" "$FORWARDER" "$RECIPIENT" "$THRESHOLD" "$WORKFLOW_ID" \
  --rpc-url "$SEPOLIA_RPC_URL" --account "$KEYSTORE_ACCOUNT"
```

实际公共链广播、bank 的 `setAutomationReceiver` 绑定及 CRE workflow 部署激活尚未执行。需要先获得具体网络、账户、目标和费用授权。直接部署 Receiver 后也必须完成 workflow 身份校验，再由银行 owner 绑定。

从 **`cre-project-23`** 运行单次 CLI 模拟（需自己的模拟 Receiver / RPC / CLI 登录配置）：

```bash
cre workflow simulate my-workflow --target staging-settings --trigger-index 0 --non-interactive
```

模拟是手动触发的一次执行；持续每 5 分钟执行需要部署并激活 workflow。[官方模拟文档](https://docs.chain.link/cre/guides/operations/simulating-workflows) 与 [部署文档](https://docs.chain.link/cre/guides/operations/deploying-workflows) 分别说明两者。具体本次 CLI 状态以 [RUN_LOG.md](RUN_LOG.md) 为准。

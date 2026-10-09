# 23 · 自动化银行：超过阈值时划走一半

智能合约不会自己在五分钟后醒来，必须有人发起调用。本项目用 Chainlink CRE 工作流定时读取银行，满足条件时生成报告，通过 Forwarder 和 Receiver 调用银行。

先完成 [07 的存取款](../tokenbank-07/README.md)。本项目直接复用那份 TokenBank，自己提供 Receiver、工作流、测试和部署脚本。

## 用 120 枚与 100 枚阈值举例

Alice 授权并存入 120 枚，阈值为 100。工作流读取 `totalDeposits=120`，发现严格大于 100，于是报告给链上 Receiver，银行划出 `120/2=60` 给固定收款人。

此后银行资产和 Alice 可提余额都剩 60。自动划出的 60 不再属于 Alice 的可提账本；不能对用户继续显示“仍可取 120”。若 Alice 存 80、Bob 存 40，则划出后分别可提 40、20。

恰好 100 不触发；直接给银行转 Token 不增加 `totalDeposits`，不参与半额计算。金额使用最小单位，本例 18 位精度的阈值为 `100000000000000000000`。

## 谁每五分钟做了什么

```text
Cron 定时触发 → workflow 读 finalized 状态
超过阈值 → 生成带 nonce 的报告 → Forwarder 提交
Receiver 验调用来源和报告序号 → 再查当前金额
TokenBank.withdrawhalf → 分摊扣账、转出一半 → nonce 前进
```

Cron 是时间触发规则；Forwarder 是把可信报告送上链的入口；Receiver 是本项目接收并检查报告的合约。链下判断之后，链上仍要重新检查，因为这期间有人可能已经提款。

nonce 是报告序号，初始为 1。成功处理后递增，旧报告不能再划一次；转币失败时序号和账本一起回滚，可用原序号重试。

`finalized` 是节点认为已最终确认的状态，可能落后于最新交易。它不是绕过链上检查的理由。银行 owner 仍有直接调用 `withdrawhalf` 的权限，该手工入口不走 CRE 阈值判断。

## 先做本地实验，再理解上线

下方先跑 Forge、Bun 测试，再手动模拟一份报告。手工 Forwarder 使用本地解锁账户，SDK 测试 runtime 代替真实 DON（去中心化节点网络）共识；它不证明公共网络已经开始每五分钟运行。

[TokenBankReceiver.sol](contracts/evm/src/TokenBankReceiver.sol) 看 `getState → _processReport`；[workflow.ts](my-workflow/workflow.ts) 看读状态、判断、写报告。最后对照 [RUN_LOG](RUN_LOG.md) 的历史余额，区分预期和当时实测。

教学版最多 100 个历史存款地址，半额划转遍历账本并处理奇数舍入；只适配无手续费、无 rebase 的标准 Token。收款人、阈值和 Forwarder 在 Receiver 部署时固定。

2026-10-09 已通过 12 项 Receiver 合约测试；未重跑 CRE SDK 工作流测试、启动定时任务或部署公共链。下面的 CLI simulate 也是单次模拟，不会自动开启长期任务。

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

模拟是手动触发的一次执行；持续每 5 分钟执行需要部署并激活 workflow。[官方模拟文档](https://docs.chain.link/cre/guides/operations/simulating-workflows) 与 [部署文档](https://docs.chain.link/cre/guides/operations/deploying-workflows) 分别说明两者。历史 CLI 状态以 [RUN_LOG.md](RUN_LOG.md) 为准。

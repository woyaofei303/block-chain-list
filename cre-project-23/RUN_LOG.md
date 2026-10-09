# TokenBank CRE 历史模拟运行日志

## 先用 100、120、60 三个数字理解证据

对照 [README](README.md)：存款恰好 100、阈值 100，应跳过；增加到 120 后应划出 60，银行和用户可提各剩 60。再次提交同一个报告应拒绝，而不是再划走 30。

读下面日志时同时检查“收款人到账、银行资产、用户可提、nonce”，只有某一项变化不足以证明账实一致。本地交易哈希不能拿到 Sepolia 浏览器验证。

本篇保留 2026-10-07 的原输出。SDK 测试 runtime 与真实生产 DON 是不同环境，CLI 单次 simulate 也不是已激活的定时任务；本次只重写阅读说明，未重新运行或上线。

验证日期：2026-10-07（Asia/Shanghai）。Forge 1.8.1，Solidity 0.8.24 / Shanghai，Bun 1.4.2，CRE SDK 1.23.0，CRE CLI 1.37.0。所有资金操作均在独立 Anvil `chainId=31337` 上；没有公共链广播、Git 提交或推送。

## CRE SDK 回调 + 真实本地 EVM

从仓库根目录执行：

```bash
bun run --cwd cre-project-23/my-workflow test:integration
```

实际输出摘录：

```text
ANVIL deposits=100 threshold=100 → skipped, writes=0
ANVIL report tx=0x9234b1db4810fedecb1afcb4dd0eab928cb577593d0409c9e6b1155048699ef1
ANVIL deposits=120 → recipient=60 bank=60 userClaim=60 nonce=2
ANVIL replay rejected; next tick skipped; user withdrew remaining 60; bank=0
TokenBank: deposits=100000000000000000000, threshold=100000000000000000000, recipient=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, nonce=1
Skipped: deposits <= threshold
TokenBank: deposits=120000000000000000000, threshold=100000000000000000000, recipient=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, nonce=1
Report accepted: observedHalf=60000000000000000000, nonce=1, tx=0x9234b1db4810fedecb1afcb4dd0eab928cb577593d0409c9e6b1155048699ef1
TokenBank: deposits=60000000000000000000, threshold=100000000000000000000, recipient=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, nonce=2
Skipped: deposits <= threshold
1 pass
0 fail
```

此哈希属于本地 Anvil，不能在 Sepolia 浏览器查询。真实调用链为：生产 `onCronTrigger` 函数 → SDK EVM capability 测试适配器 → Cast RPC → 已部署 Receiver → TokenBank → BaseERC20。测试读取真实回执和三种余额；模拟的部分是 DON runtime、签名与 Forwarder 发送账户，不是余额或合约执行。

最终集成测试按工作流要求读取 `finalized` 区块；每次本地交易后挖 64 个空块，避免读取到部署或存款之前的旧状态。最终原始输出为 `output-tdd/tokenbank-cre/integration-final.log`。

## Foundry 行为测试

```text
12 passed; 0 failed; 0 skipped
testFuzzHalfRoundingKeepsEveryClaimBacked: 256 runs
```

覆盖授权/提款、严格阈值、多用户奇数舍入、uint256 最大金额、受信 Forwarder 与 workflow ID、报告重放、ERC20 返回 false 的原子回滚和重试、三个资金入口的重入保护、100 人上限及冷存储 gas 预算。

首次加入重放测试时实测失败 `replayed report must fail`；加入 nonce 消费与回滚后通过。该行为红测日志保存在忽略目录 `output-tdd/tokenbank-cre/replay-red.log`。

`forge fmt --check`、`forge build` 均退出 0。Forge lint 仍有提示/告警，并非零告警：未修改的模板包含 timestamp、可关闭校验和类型转换提示；自有 Receiver 的 Forwarder 非零校验实际由基类构造完成，报告事件在成功的银行调用之后发出；测试包含固定 Token 的未使用返回值、循环外部调用及精确余额比较。完整信息保留在 `output-tdd/tokenbank-cre/build-final.log`，未全局禁用 lint。

## TypeScript 与 WASM

```text
bun run typecheck: exit 0（工作流、单测、集成测试分别严格检查）
bun run check: 10 files checked, no fixes applied
bun run test: 8 pass / 0 fail
cre-compile main.ts ../../output-tdd/tokenbank-cre/workflow.wasm:
✅ Workflow built: .../output-tdd/tokenbank-cre/workflow.wasm
```

Foundry 部署脚本的无广播模拟、Anvil 广播均成功；本地示例 Token / Bank / Receiver 地址分别为：

```text
Token:    0x5FbDB2315678afecb367f032d93F642f64180aa3
Bank:     0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
Receiver: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
```

原始日志与部署记录在 `output-tdd/tokenbank-cre/`，不纳入 Git。新的 Remix 浏览器测试尚未执行；旧 Remix 的 5/0 记录仅代表历史版本。

## CRE CLI 实际模拟

使用同一份已编译 WASM、独立本地 Anvil 和隔离的 CRE project，未传 `--broadcast`。该轮银行存款为 0，验证 CLI 的 Cron → finalized RPC → ABI 解码 → 跳过分支，退出码 0：

```text
2026-10-07T20:45:33Z [SIMULATION] Running trigger trigger=cron-trigger@1.0.0
2026-10-07T20:45:33Z [USER LOG] TokenBank: deposits=0, threshold=100000000000000000000, recipient=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, nonce=1
2026-10-07T20:45:33Z [USER LOG] Skipped: deposits <= threshold
✓ Workflow Simulation Result:
"Skipped"
```

原始输出：`output-tdd/tokenbank-cre/cre-cli-simulate-isolated.log`。CLI 写入分支未在 MockForwarder 上执行；120 → 60 的真实划款证据来自前述 SDK + Anvil 集成测试，不把两种验证混为一谈。尚未在 DON 上部署、激活定时任务。

本地配置及运行约束：

- 临时 project 的 `project.yaml` 将 `ethereum-testnet-sepolia` capability 名映射到 `http://127.0.0.1:18545`；底层仍是本地 `chainId=31337`，不是 Sepolia。
- workflow 文件夹位于该临时 project 内；先前将仓库外部 workflow 路径与临时 project-root 混用时返回空数据，改成同一项目后通过。
- Anvil finalized 最初为区块 0；部署后挖空块再读取。测试中也固定按 finalized 读取。
- CLI 对配置路径有长度限制，临时使用 `/tmp/cre-tokenbank.UTQaiL/artifacts` 短路径软链接；没有更改仓库原 RPC、环境文件或凭证。
- `--env /dev/null --public-env /dev/null` 避免读取项目密钥；中间一次账号认证失败，后续重试恢复。日志中的默认模拟 key 提示不表示使用了用户私钥，也没有广播公共交易。

当时执行命令（临时节点及短路径链接在验证后已关闭/移除）：

```bash
cre workflow simulate /tmp/cre-tokenbank.UTQaiL/artifacts/cli-project/my-workflow \
  --project-root /tmp/cre-tokenbank.UTQaiL/artifacts/cli-project \
  --target staging-settings \
  --config /tmp/cre-tokenbank.UTQaiL/artifacts/cli-config.json \
  --wasm /tmp/cre-tokenbank.UTQaiL/artifacts/workflow.wasm \
  --env /dev/null --public-env /dev/null --trigger-index 0 --non-interactive
```

正式 Receiver 部署入口也在本地用非零 workflow ID 做了无广播模拟，退出 0，输出 `Script ran successfully`；记录在 `receiver-deploy-dry-run.log`。该次 Forge trace 报了源码解析/旧生成缓存提示，之后已通过 `forge build --force` 重建（15 个文件、编译成功），未修改第三方模板；这不代表完成了公共链部署。

共享 pre-commit 已接入当时的检查，shell 语法检查通过；未创建 Git 提交，因此未实际触发提交钩子。文档 107 个本地链接目标存在，`git diff --check` 通过，环境文件和临时日志均被忽略。

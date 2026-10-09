# Permit 项目的公共测试网部署与历史记录

先完成 [本地学习入口](README.md) 和 [本地流程](WALKTHROUGH.md)，再阅读本篇。它保存原有 Sepolia 部署命令、公开地址和验证记录，避免把历史环境混进首次学习。

部署脚本创建 Token 和银行，**不迁移旧银行余额**。交易模拟只预测当前状态下的执行结果；只有广播并取得成功回执才产生新部署。账户升级、Token 授权和存款是另外的动作。

下方日期、地址、测试数量属于各自历史版本。本次文档重构未重新核验公共 RPC、钱包兼容性或外部页面，也未签名和广播；按记录复习时以实际链上状态为准。

## Sepolia 部署（MetaMask 签名）

[部署脚本](contracts/script/DeploySepolia.s.sol) 创建 `JulianToken` 和 `IdempotentTokenBank`，共两笔交易；部署账户获得 1,000,000 JUL，银行初始存款为零。普通授权、Permit、Permit2、EIP-7702 共用这一个银行。

脚本仅允许 Sepolia（chain ID `11155111`），广播前检查两个已有官方合约的代码：

- Permit2：`0x000000000022D473030F116dDEE9F6B43aC78BA3`，见 [Uniswap 部署表](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments)。
- MetaMask Delegator：`0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`，由钱包在 EIP-7702 存款时处理账户升级。

部署不会自动完成 EIP-7702 账户升级、Token 授权或存款。使用支持 `--browser` 的 Foundry（历史记录为 1.8.1），由 MetaMask 确认每笔部署；流程见 [Foundry 官方说明](https://www.getfoundry.sh/guides/browser-wallet)。

从仓库根目录进入合约目录，先模拟；`DEPLOYER_ADDRESS` 必须替换为你当前 MetaMask 账户的完整公开地址：

```bash
cd "$(git rev-parse --show-toplevel)/eip712-permit-16/contracts"
export SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
export DEPLOYER_ADDRESS='<本人当前钱包的完整公开地址>'

forge script script/DeploySepolia.s.sol:DeploySepolia \
  --sig 'run(address)' "$DEPLOYER_ADDRESS" \
  --sender "$DEPLOYER_ADDRESS" \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --with-gas-price 2gwei --priority-gas-price 1000000
```

在安装 MetaMask 的浏览器中切到 Sepolia，核对模拟结果后广播。以下命令在同一终端执行，钱包选择上述部署地址：

```bash
forge script script/DeploySepolia.s.sol:DeploySepolia \
  --sig 'run(address)' "$DEPLOYER_ADDRESS" \
  --sender "$DEPLOYER_ADDRESS" \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --with-gas-price 2gwei --priority-gas-price 1000000 \
  --broadcast --browser --slow
```

Foundry 会打开 `http://127.0.0.1:9545`，连接 MetaMask 后逐笔确认。两笔交易的 ETH 转账金额都是 `0`，只支付 Gas；最大单价设为 `2 gwei`，总费用按本次模拟的 Gas 和钱包显示核对。若当前基础费超过上限，先重新估算再调整。

成功后以 `contracts/broadcast/DeploySepolia.s.sol/11155111/run-latest.json` 中的成功回执为准；`dry-run/` 下的地址不是已部署证据。中途失败或超时先查这份记录和链上回执，不要直接重跑新部署；确认已完成部分及待处理 nonce 后，原命令加 `--resume` 恢复。

前后端须使用同一组 Sepolia 地址：前端 `NEXT_PUBLIC_CHAIN_ID=11155111`、`NEXT_PUBLIC_BANK_ADDRESS=<成功部署的银行地址>`；后端 `CHAIN_ID=11155111`、`RPC_URL=<Sepolia RPC>`、`TOKEN_ADDRESS=<成功部署的 JUL 地址>`、`BANK_ADDRESS=<成功部署的银行地址>`、`START_BLOCK=<Token 部署区块>`。使用独立数据库及端口，保留本地 Anvil 配置和状态；前端环境变量改变后重新构建。

2026-09-24 已通过 27 项合约测试、格式检查和 Sepolia RPC 部署模拟。模拟得到两笔 CREATE，总 Gas 上限估算 `2,155,467`，按 `2 gwei` 为 `0.004310934 SepoliaETH`。此记录仅为模拟，实际部署状态以钱包签名后的回执为准。

### 历史部署与测试页面（2026-09-24）

用户通过 MetaMask 确认两笔交易，Sepolia 回执均为成功，总实际费用 `0.001796863833098025 SepoliaETH`：

```text
部署账户：0x000071424bb08b910f0786e04D964A63D64bF1Ba
JUL：     0x911B0B941753e6F3c36a92e4Df76B7b78F3277A2
银行：    0x0c0848F28228cffF0A60538E6e2c2e364f8168Bc
Token 部署区块：11770843
银行部署区块：  11770845
```

交易证据：[Token 部署](https://sepolia.etherscan.io/tx/0x13ac3e2d8b41800bac763eee7385e9c444070b50d4fe83e8df464ac3ec77b51d)、[银行部署](https://sepolia.etherscan.io/tx/0x19a9c7841e7f42383d03b33173217b391f2fb8b859f3c38e25d23205446315db)。链上只读核对已确认银行的 Token / Permit2 地址、JUL 精度 `18`，以及部署账户持有 `1,000,000 JUL`。

Sepolia 页面：[http://127.0.0.1:3019](http://127.0.0.1:3019)，后端 `13019`，独立数据库 `tokenbank_sepolia_16`。配置保存在本机忽略的 `output-tdd/eip712-consolidate/demo/session.env`（首次运行生成，本机文件）。索引等待 `12` 个确认，刚完成的交易记录会晚于钱包余额出现。

为保留 `3018` 的 Anvil 页面，本次 Sepolia 前端在 `output-tdd/eip7702-sepolia/frontend/` 的源码副本使用现有依赖构建（`build --webpack`）；该副本不是源码维护入口。服务停止后，可分别在两个终端从本项目目录恢复，跳过部署和建库：

```bash
cd "$(git rev-parse --show-toplevel)/eip712-permit-16"
set -a
source ../output-tdd/eip7702-sepolia/session.env
set +a
env -u DATABASE_URL -u PGOPTIONS node backend/src/main.ts
```

```bash
cd "$(git rev-parse --show-toplevel)/eip712-permit-16"
set -a
source ../output-tdd/eip7702-sepolia/session.env
set +a
pnpm --dir ../output-tdd/eip7702-sepolia/frontend start --port "$FRONTEND_PORT"
```

公共链实测目前完成的是部署；EIP-7702 存款仍需在新页面连接 MetaMask 后实际签名验证。

## 限制

- 默认演示本地 EVM / Anvil；Sepolia 部署入口与验证范围见上节。没有课程提交，旧部署不能因源码迁移自动升级。
- 标准无手续费、无 rebase Token；前端 Permit version 固定为本项目的 `1`。签名面向 EOA，没有 ERC-1271。
- SIWE、Token nonce、白名单 nonce、operationId 分别负责不同权限与去重，不可互相替代。签名不保存在浏览器恢复记录。
- 索引器只索引 JUL 的 Transfer；NFT 转移用回执、`ownerOf` 和测试断言核对，未新增 NFT 数据库索引或交易页面。
- 测试 NFT URI 是占位值；本次不上传 IPFS。历史 11 题的媒体与部署证据仍留在原目录。
- 终止请求只停止等待和后续步骤，不能撤回已广播交易；恢复必须先核实原 operationId / 哈希。

## Permit2 扩展实测（2026-09-23）

原有银行、页面和业务流程已扩展 Permit2，测试与日志见 [Permit2 操作指南](PERMIT2.md#历史实测记录)。旧部署仍保留原功能，启用 Permit2 必须部署新的银行及官方 Permit2。

## 历史 EIP-2612 Review 与实测（2026-09-23，Permit2 扩展前）

题目要求的两点均已实现，并在本轮重新执行：

1. **存款成功测试**：[Foundry 用例](contracts/test/PermitTokenBank.t.sol) 验证无需预先 approve 的 Permit 存款，断言用户余额减少、银行资产和个人存款增加；[RPC 用例](frontend/tests/permit.integration.mts) 调用真实银行客户端，另断言只广播一笔存款交易及回执的 ERC20 Transfer。
2. **NFT 购买成功测试及转移证据**：[Foundry 用例](contracts/test/NFTMarket.t.sol) 和上述 RPC 用例均验证 buyer 付款、seller 收款、NFT owner 变更；RPC 用例同时解码并断言 ERC20 / ERC721 Transfer 的 from、to、value / tokenId。

本轮 RPC 日志中的实际结果（JUL 为 18 位精度）：

```text
Permit 存款 10.000000000000000001 JUL：
buyer 钱包：1000 → 989.999999999999999999
银行资产 / buyer 存款：0 → 10.000000000000000001
ERC20 Transfer：buyer → bank，value = 10000000000000000001

白名单购买 Blocklight Genesis #0：
ERC20 Transfer：buyer → seller，value = 100000000000000000000（100 JUL）
ERC721 Transfer：seller → buyer，tokenId = 0
ownerOf(0) = buyer，白名单 nonce = 1
```

两笔交易的本地哈希、完整地址、余额及解码事件保存在 [RPC 原始日志](../output-tdd/eip712-review/permit-integration.log)。[Foundry Transfer 轨迹](../output-tdd/eip712-review/transfers.log) 展示合约调用和事件；这两份日志即可证明本地模拟中的 Token / NFT 转移，不依赖截图。

Review 修复及精简：

- 修复共享代理默认端口 `3001 → 13016`，避免未设置 `INDEXER_URL` 时连到旧项目；补入默认地址回归检查，已验证修复前失败、修复后通过。
- 修复测试清理：Anvil 启动后立即独立注册回收，数据库配置/清理异常不会跳过节点回收；节点已退出时不再等待第二次 exit。无效 `DATABASE_URL` 的异常路径已实测，无遗留 Anvil。
- 删除银行客户端 3 处重复账户/网络检查；保留读取开始/结束、签名前后及统一广播入口的校验。拒签、切换账户/链、取消后停止及晚返回哈希的测试继续通过。
- 保留普通 Token、旧银行兼容用例和市场基类：它们分别承担回归与实际复用职责；未新增框架、依赖或通用抽象。

完整自动流程已通过 [Approve 日志](../output-tdd/eip712-review/fullstack-approve.log) 和 [Permit 日志](../output-tdd/eip712-review/fullstack-permit.log)：部署合约 → SIWE 登录 → 后端登记 → 页面实际 `executeIntent` 编排 → 签名/授权 → 存款 → 丢失哈希后按原编号恢复且不重复广播 → 提款 → PostgreSQL 索引 → 同源代理查询。另覆盖并发去重、重组后的重新核实和过期 Permit 回滚。

本轮验证：20 项合约测试（含 256 次 fuzz）、前端 12 项单元测试及 2 项 RPC 集成、后端 4 项测试及 Approve / Permit 两种全栈集成全部通过；前后端 lint、格式、严格类型检查及生产构建通过。因原目录开发服务正在运行，生产构建使用相同源码与依赖的隔离副本；在 `3017` 验证了未连接页面、钱包弹窗、存入/取出切换，控制台无错误。未操作现有 `8547` / `3016` 服务。

[共享 pre-commit](../output-tdd/eip712-review/hook.log) 已用临时 Git index 实跑通过，真实暂存区未改变。文档本地链接及 Bash / Zsh 命令语法通过；测试节点、临时 schema 和本轮生产预览已清理。其他检查日志：[合约](../output-tdd/eip712-review/forge-test.log)、[前端](../output-tdd/eip712-review/frontend-quality.log)、[后端](../output-tdd/eip712-review/backend-quality.log)、[生产构建](../output-tdd/eip712-review/build.log)、[异常清理](../output-tdd/eip712-review/cleanup-check.log)。

完整交易自动化使用真实本地 Anvil、PostgreSQL 和 Express；Node 适配器只补浏览器 origin/cookie，并调用真实 Next Route Handler。**没有使用真实钱包扩展人工点击签名，也没有公共链交易**，浏览器验收范围是未连接状态。原始日志在忽略的 `output-tdd/eip712-review/`，复现命令见 [操作指南第 9 节](WALKTHROUGH.md#9-全套验证与作业日志)。

## 历史整合记录

2026-09-23，Node.js 24.14.0、Foundry 1.8.1、Solc 0.8.24，在本目录执行并通过：

- 20 项合约测试（含 256 次 fuzz）、前端 12 项单元测试与 2 项 RPC 集成、后端 4 项单元/数据库测试与 Approve / Permit 两种全栈集成。
- 前后端 lint、格式与严格类型检查，前端生产构建，共享 pre-commit。钩子用临时 Git index 验证，真实暂存区未改变。整合目录的生产页面在浏览器未连接状态正常渲染，无控制台错误。
- 直接执行操作指南中的本地部署、项目方签名、模拟和白名单购买命令：buyer 支付 100 JUL 后持有 NFT #0，余额 900 JUL、市场 nonce 为 1。
- 停止并重新加载本地 Anvil 状态后，NFT owner、JUL 余额、nonce 与购买回执仍可读取。文档命令通过 Bash / Zsh 语法检查，所有本地文档链接有效。

证据位于本地忽略目录，克隆后按操作指南生成：

- [合约测试](../output-tdd/eip712-consolidate/forge-test.log)、[Token / NFT Transfer 轨迹](../output-tdd/eip712-consolidate/transfers.log)。
- [Permit RPC 测试](../output-tdd/eip712-consolidate/permit-integration.log)、[全栈 Permit 测试](../output-tdd/eip712-consolidate/fullstack-permit.log)。
- [文档命令实测](../output-tdd/eip712-consolidate/cli-demo.log)、[状态恢复核对](../output-tdd/eip712-consolidate/restore-check.json)、[构建](../output-tdd/eip712-consolidate/build.log)、[共享钩子](../output-tdd/eip712-consolidate/hook.log)。

该轮验证不包含真实钱包扩展的人工签名，也未运行公共链交易。文档演示留下的本地部署与状态在 `output-tdd/eip712-consolidate/demo/`，NFT #0 已成交；当时未为这个手工演示创建持久数据库，后端全栈测试使用的是已清理的临时 schema。要继续演示银行页面，先恢复这条链，再按操作指南首次创建数据库并启动前后端；不要重复部署 NFT。

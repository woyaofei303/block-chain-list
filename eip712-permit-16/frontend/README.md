# Permit 银行前端

从第 13 题复用现有 Next.js 16 / React / TypeScript / Tailwind 4 / Wagmi / Viem / TanStack Query 页面，保留普通授权、Permit、Permit2，并增加 EIP-7702 原子存款。完整安装、钱包配置、部署和联调命令统一见 [WALKTHROUGH](../WALKTHROUGH.md)，业务流程见 [总览](../README.md) 与 [请求说明](../REQUESTS.md)。

## 页面操作

1. 连接具体钱包，核对账户、chain ID 和 RPC；银行设置填写本轮 `IdempotentTokenBank` 地址。
2. 输入金额，选择“普通授权”“Permit 一笔存款”“Permit2 存款”或“EIP-7702 一笔存款”。Permit 先签署本次额度，再确认一笔存款交易；Permit2 在已有足够额度时一笔，首次无额度仍需先授权。EIP-7702 将授权与存款放入原子批次；首次操作另需 SIWE 身份签名。
3. “取出”只可提取自己的银行存款。钱包余额、个人存款、银行总资产分别展示，禁止用总资产作为个人提款额度。
4. 已广播后等待超时或刷新，先“核实结果”，需要继续时沿用原 operationId；终止不等于交易被撤回。
5. 历史记录来自后端索引，可能晚于链上余额更新。服务错误和未连接状态不会伪造零余额或成功记录。

未支持 Permit 的 Token 或旧幂等银行使用普通授权；无 operationId 的历史银行只读。金额按合约 decimals 转为 bigint，拒绝零、负数、科学计数法、超精度及超额。

## 配置与源码

`.env.example` 仅含公开参数；`.env.local` 不纳入 Git。默认本地 RPC 为 `8547`，演示页面端口为 `3016`，`INDEXER_URL` 指向后端 `13016`。`NEXT_PUBLIC_` 进入浏览器，不能保存密钥。生产构建会固定公开环境变量，修改后须重新构建。

- `features/bank-dashboard.tsx` / `bank-workspace.tsx`：原页面布局及工作区。
- `domains/bank/client.ts`：余额、金额、账户/网络校验、Permit、模拟、交易与回执。
- `domains/operations/client.ts`：登录、持久化意图、幂等和恢复。
- `shared/request.ts` / `error-queue.ts`：HTTP 并发 6、取消、错误容量 3。
- `app/api/`：Next 同源代理；浏览器不直接连接数据库。
- `scripts/permit-setup.mts`：本地部署入口，stdout 为 JSON，提示写 stderr，便于命令行保存配置。

本目录使用 pnpm 与原锁文件，Husky 仍指向仓库共享钩子。请勿与同目录开发/生产服务同时运行 build。

从本项目根目录执行：

```bash
pnpm --dir frontend lint
pnpm --dir frontend format:check
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend test:integration
pnpm --dir frontend test:permit
pnpm --dir frontend build
```

普通 RPC 测试验证历史银行只读、普通授权、取消与恢复；Permit RPC 测试直接调用生产客户端，并完成 NFT 白名单购买。它们使用独立 Anvil，不要求真实钱包扩展，也不能当作人工扩展钱包验收。

## EIP-7702 一笔存款

题目基于 [TokenBank 前端练习](https://decert.me/quests/56e455b3-901c-415d-90c0-a20759469cf9)。本实现沿用现有 `IdempotentTokenBank.deposit(uint256,bytes32)`，没有修改合约，也不开放旧版银行的写入口。

指定 MetaMask Delegator（不是 TokenBank 地址，也不是 approve 的 spender）：

```text
0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B
```

阅读顺序：`features/bank-workspace.tsx` 选择模式 → `domains/operations/client.ts` 保存模式与原操作编号 → `domains/bank/client.ts` 的 `batchCapability` / `transact` / `confirmCalls` → 后端按 `OperationExecuted` 事件确认实际入账。

1. 使用支持 EIP-7702 / EIP-5792 的 MetaMask，在受支持的网络准备同网络的 Token、幂等版银行及索引/操作服务。建议公共测试选择 Sepolia；已有 `31337` Anvil 能运行合约不代表 MetaMask 对该网络开放 `wallet_sendCalls`。现有公共链历史地址不代表兼容的银行已部署。
2. 按 [操作指南](../WALKTHROUGH.md) 或 [Permit2 指南](../PERMIT2.md) 配置前后端同一网络、银行、Token、RPC 与 `PUBLIC_ORIGIN`。普通、Permit 和 Permit2 继续使用原流程；EIP-7702 不可用不影响其他存款方式。不要把 Delegator 填进银行设置。
3. 连接 MetaMask，选择「EIP-7702 一笔存款」。页面通过 `wallet_getCapabilities` 接受 `atomic.status` 为 `ready` 或 `supported`，检查指定 Delegator 有代码；账户必须尚未委托或已委托给指定地址。否则禁用提交并显示原因。
4. 输入金额并点击「一笔授权并存入」。首次登录可能有 SIWE 签名，钱包也可能提示升级智能账户。EIP-7702 授权由 MetaMask 管理；页面不持有私钥，不构造自定义授权签名。`sendCalls` 本身没有用于任意指定 Delegator 的标准参数，因此在发送前检查已有委托、成功回执区块再次核对指定地址。
5. 请求固定为 EIP-5792 `version: "2.0.0"`、`atomicRequired: true`，包含两个有序调用：Token 的 `approve(bank, amount)` 和银行的 `deposit(amount, operationId)`。每次授权仅本次金额，两步整体成功或回滚；不自动降级为顺序交易。
6. 返回的 `callsId` 是批次编号，不是交易哈希。页面使用 `wallet_getCallsStatus` 查询原批次，核对网络、编号、`atomic: true`、仅一张成功回执，以及对应区块账户代码 `0xef0100 + 指定 Delegator 地址`。后端仍须核实同账户、同编号、同金额的银行事件，才显示存入成功。索引完成后显示转出记录。

可在区块浏览器核对同一笔交易中的 `Approval`、`Transfer` 和 `OperationExecuted`，以及个人银行存款增加。已升级账户后续交易不一定是 type 4；不能只凭交易类型判断 EIP-7702 是否生效。首次账户升级可能额外产生钱包交互/交易；本题的一笔指授权与存款的执行交易，不是承诺只有一次弹窗。

恢复时沿用原操作编号与批次编号。终止后停止轮询，晚返回的批次编号仍保存；「核实结果」只查询一次，「使用原操作继续」等待已有批次，不重复发送。明确拒签或完整回滚后可手动重试原操作；部分失败、网络超时和回执不一致保留记录。若请求已送达但未返回批次编号，页面阻止重发，须先核对钱包；即使后端发现入账，缺少批次凭证也不会宣称本题验收成功。

从 `eip712-permit-16/frontend` 执行接口测试与可选官方字节码集成测试：

```bash
node --test tests/eip7702.test.mts
EIP7702_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com pnpm test:integration
```

第二条命令仅从公共 RPC **读取**官方字节码；所有部署、委托设置和交易都在自动清理的随机端口 Anvil。它用 `anvil_setCode` 设置本地委托，用测试钱包适配 EIP-5792，并实际执行官方 Delegator；这证明单笔执行、账户记账和整体回滚，不代表 MetaMask 扩展签名或公共链交易已验收。未设置 `EIP7702_RPC_URL` 时跳过该可选子测试，其余本地集成检查照常运行。


参考：[MetaMask 官方 Delegator 地址](https://support.metamask.io/configure/accounts/what-is-a-smart-account)、[MetaMask 批量交易](https://docs.metamask.io/metamask-connect/evm/guides/send-transactions/send-batch-transactions/)、[EIP-5792](https://eips.ethereum.org/EIPS/eip-5792)、[官方执行合约](https://github.com/MetaMask/delegation-framework/blob/v1.3.0/src/EIP7702/EIP7702DeleGatorCore.sol)。

2026-09-24 本次实测：19 项前端单元测试、普通存取款与官方 Delegator 原子执行/整体回滚集成、Permit 与 Permit2 RPC 回归、两种签名存款的 PostgreSQL 全栈回归、lint、格式、类型检查及生产构建通过。浏览器确认四种入口同时保留，可切换普通授权、EIP-7702 与提款；未操作真实钱包扩展签名，未向公共链广播。公共 RPC 直连首次超时，使用系统代理后完成官方字节码测试。

本轮页面使用已保存的 Permit2 环境：`http://127.0.0.1:3018`，钱包 RPC 为 `http://127.0.0.1:8548`，chain ID 为 `31337`。前后端已启动，索引追平区块 11。该链与原 `8547` 的资产独立；原链状态及数据库保留。本地 MetaMask 是否允许 EIP-7702 仍以页面能力检查为准，不影响普通、Permit、Permit2。

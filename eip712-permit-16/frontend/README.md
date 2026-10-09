# 签名银行前端：看懂每一次钱包弹窗

按 [WALKTHROUGH](../WALKTHROUGH.md) 启动本地环境，再连接钱包。本篇用“钱包原有 100 JUL、存入 10”解释页面流程，详细恢复机制在 [REQUESTS](../REQUESTS.md)。

## 页面操作

连接具体账户后，先核对网络和银行地址。输入 10，选择方式；成功后应为钱包 90、个人存款 10，银行实际资产增加 10。取出 4 后个人剩 6，只能取自己的份额。

钱包可能先要求 SIWE 登录签名，这只是证明身份。随后几种方式的弹窗用途不同：

- 普通：额度不足时 approve 交易，再 deposit 交易。
- Permit：签本次 10 JUL 授权，再发一笔 permitDeposit。
- Permit2：若 Token 对 Permit2 额度不足，先 approve 本次金额，再签一次性许可和存款；已有足够额度才省去前一笔。
- EIP-7702：钱包支持时，把授权与存款原子执行；升级账户的提示不等于银行扣款。

金额按 decimals 转 bigint，拒绝零、负数、科学计数法、超精度与超额。签名只对指定链、合约、金额和有效期有效，不随意确认不认识的数据。

已广播后超时，先核实原操作；终止只停止等待，不撤回交易。历史由后端索引，可能晚于余额；服务失败不会被伪装成“余额零”或“存款成功”。

## 配置与源码

普通本地指南使用 RPC 8547、后端 13016、页面 3016；独立 Permit2 指南使用 8548、13018、3018。这两条链的资产互不共享，所有地址必须来自同一轮配置。

`NEXT_PUBLIC_` 会进入浏览器，不能存密钥；INDEXER_URL 留服务端。公开环境变量改变后，生产构建需重做，不要让 dev、build、start 并发使用同一目录。

先读 `features/bank-workspace.tsx` 的模式选择，再读 `domains/operations/client.ts` 的意图与恢复、`domains/bank/client.ts` 的签名与交易。`app/api` 只是同源代理，浏览器不直连数据库。

在项目根目录执行检查：

```bash
pnpm --dir frontend lint
pnpm --dir frontend format:check
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend test:integration
pnpm --dir frontend test:permit
pnpm --dir frontend test:permit2
```

这些 RPC 测试用独立 Anvil，不能代替实际钱包扩展测试。2026-10-09 已通过 19 项前端测试、本地存取款及 Permit/Permit2 集成，lint 和类型检查也通过；指定 Delegator 字节码的集成场景跳过，未启动页面做扩展钱包验收。下面保留 EIP-7702 的具体约束和历史验证，先理解流程再读协议细节。

## EIP-7702 一笔存款

可以把原子批次理解为“一张申请单里的两个动作同时生效”：先 approve、后 deposit，第二步失败时第一步也撤销。它依赖钱包支持，不是简单连发两次交易。



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

历史记录（2026-09-24）：19 项前端单元测试、普通存取款与官方 Delegator 原子执行/整体回滚集成、Permit 与 Permit2 RPC 回归、两种签名存款的 PostgreSQL 全栈回归、lint、格式、类型检查及生产构建通过。浏览器确认四种入口同时保留，可切换普通授权、EIP-7702 与提款；未操作真实钱包扩展签名，未向公共链广播。公共 RPC 直连首次超时，使用系统代理后完成官方字节码测试。

该轮页面使用当时保存的 Permit2 环境：`http://127.0.0.1:3018`，钱包 RPC 为 `http://127.0.0.1:8548`，chain ID 为 `31337`。当时前后端已启动，索引追平区块 11；不表示这些服务当前在线。该链与原 `8547` 的资产独立；原链状态及数据库保留。本地 MetaMask 是否允许 EIP-7702 仍以页面能力检查为准，不影响普通、Permit、Permit2。

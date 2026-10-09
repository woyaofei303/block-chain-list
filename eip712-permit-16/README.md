# 16 · 签名存款：少一次授权交易，仍然正确记账

在 [13 的普通 TokenBank](../tokenbank-fullstack-13/README.md) 中，额度不足时要先 approve，再 deposit。本项目让用户先签一份授权消息，由银行在存款交易里使用它，并练习“指定买家才能购买”的 NFT 白名单。

先理解 ERC20 授权和全栈存款，再读这里。普通、Permit、Permit2、EIP-7702 四种方式共用银行账本、操作编号和页面，不需要分别开四个账户。

## 用 Alice 存 10 JUL 解释 Permit

Alice 钱包有 100 JUL。她签署“允许这家银行在截止时间前使用我的 10 JUL”，签名本身不移动代币。随后调用 `permitDeposit`，银行在同一交易中提交授权并转入 10，个人存款增加 10。

如果授权或转币失败，整笔交易回滚。最终仍是钱包 90、个人存款 10。减少的是单独 approve 的交易，不是让链上存款免费。

**EIP-712** 是结构化签名格式：把“链、合约、字段”明确写进待签数据。**EIP-2612 Permit** 是 ERC20 利用这种签名完成授权的标准。本项目 Token 名称 `Julian Token`，符号 `JUL`，18 位精度，部署者得到 1,000,000 枚。

## 四种入口各自解决什么

- **普通授权**：额度不足时 `approve → deposit`，两笔链上交易。
- **Permit**：Token 自身支持 `permit`，签名后用一笔 `permitDeposit` 完成授权与存入。
- **Permit2**：Token 先授权 Permit2；之后签一次性转账许可。无已有额度时仍需先 approve；页面只补本次金额，不能承诺以后永远只要一笔。
- **EIP-7702**：钱包支持原子批量调用时，把 approve 与 deposit 放进一笔执行交易；首次升级账户可能另有步骤。支持性由钱包和网络共同决定。

SIWE 登录签名只是向后端证明身份，和上述花币授权不同。NFT 白名单又是项目方签给买家的购买资格，不代替买家的付款授权。

## 先自动完成一次本地练习

需要 Node.js 24+、前端 pnpm、后端 npm、Foundry；后端集成还需 PostgreSQL。从仓库根目录执行：

```bash
cd eip712-permit-16
pnpm --dir frontend install --frozen-lockfile
npm --prefix backend ci
forge build --root contracts/lib/permit2
forge test --root contracts -vvv
pnpm --dir frontend test:permit
pnpm --dir frontend test:permit2
```

Permit2 官方源码使用单独的 Solidity 0.8.17 编译配置；业务合约用 0.8.24，所以先构建前者。第三方库还复用 09 的目录，保留完整仓库。

有可连接的 PostgreSQL 后可验证全栈：

```bash
TEST_PERMIT=1 npm --prefix backend run test:integration
TEST_PERMIT2=1 npm --prefix backend run test:integration
```

本地集成用独立 Anvil 和临时 schema。实际页面操作见 [WALKTHROUGH](WALKTHROUGH.md)，Permit2 的额度与签名详解见 [PERMIT2](PERMIT2.md)。2026-10-09 已通过 27 项合约、19 项前端、4 项后端测试，及 4 项本地集成测试（含 Permit、Permit2），前后端 lint 和类型检查也通过。依赖指定 Delegator 字节码的 1 项集成场景因未提供该输入而跳过，钱包批次逻辑另由 7 项边界测试覆盖；未验收真实钱包扩展。

## 一份签名为什么不能随便复用

Permit 包含 owner、spender、value、nonce、deadline；签名域还绑定 chain ID 和 Token 地址。把 10 改成 100、换银行、换链或超过截止时间，都会破坏约束。

`nonce` 是防止旧授权重复消费的编号；它和业务 `operationId` 不同。operationId 表示“这次存款”，同用户同编号同参数再次提交不重复扣款。已完成的操作先按编号返回，不再消费签名。

如果 Permit 被提前提交过，只要银行已有足够 allowance，存款仍可继续。银行按实际调用者记账，不接受“拿别人的签名给自己增加余额”。

## 再看 NFT 白名单购买

Alice 把 0 号 NFT 标价 100 JUL。项目方签名允许 Bob 在期限前按该订单购买。Bob 仍需给市场 100 JUL 付款额度，然后调用 `permitBuy`。

签名绑定买家、卖家、NFT 编号、价格、nonce、期限、链和市场。成交后 nonce 增加、挂单清除、Alice 收到 JUL、Bob 得到 NFT；任何一步失败都回滚。

这里禁用了继承来的普通购买和回调入口，避免绕过白名单。撤单不一定永久作废旧签名：若相同条件在有效期内重新上架，未消费的签名仍可能有效。

## 顺着调用链读代码

1. [JulianToken.sol](contracts/src/JulianToken.sol) 与 [银行](contracts/src/IdempotentTokenBank.sol)：先理解 Permit 授权如何接到原存款。
2. [银行客户端](frontend/domains/bank/client.ts)：看域、金额、签名和钱包请求如何组合。
3. [REQUESTS](REQUESTS.md)：看原编号怎样用于刷新、终止和超时恢复。
4. [PermitNFTMarket.sol](contracts/src/PermitNFTMarket.sol)：比较花币授权与购买资格。
5. [前端](frontend/README.md)、[后端](backend/README.md)、[数据库](database/README.md)：逐层查页面显示与链上结果。

## 常见误解与进一步操作

签名免费不等于存款免 Gas；钱包弹了一个窗口不等于只有一笔交易；合约能在 Anvil 跑不等于 MetaMask 对本地网络支持 EIP-7702。页面的能力检查与结果核实见 [EIP-7702 说明](frontend/README.md#eip-7702-一笔存款)。

当前银行适配无手续费、无 rebase 的 Token，签名流程按 EOA 钱包设计。旧银行不会自动升级，新部署也不搬走旧余额。公共测试网命令与历史证据见 [DEPLOYMENT](DEPLOYMENT.md)，不要把其中旧地址当成本轮本地部署。

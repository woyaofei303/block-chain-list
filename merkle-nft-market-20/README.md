# 20 · Merkle 白名单：证明你在名单里，再五折买 NFT

名单有很多人时，不必把所有地址逐个存上链。这个项目把整份名单计算成一个 Merkle root（根哈希），买家带一小段 proof（证明路径），合约就能检查其资格。

先理解 [08 的 NFT 市场](../tokenbankv2-08/README.md) 与 [16 的 Permit](../eip712-permit-16/README.md)。合约名按原题保留拼写 `AirdopMerkleNFTMarket`。

## 用 Alice、Bob、Carol 三人理解证明

先把每个地址按固定方式哈希成叶子，再两两合并计算上层哈希，最后得到一个 root。Bob 买东西时提供沿路需要的兄弟哈希，合约把 Bob 的地址算进去；最终结果等于部署时保存的 root，才通过。

proof 不需要保密。别人拿到 Bob 的 proof，也不能冒充 Bob：合约验证的是本次调用者 `msg.sender`。资格只表示“在名单中”，本实现没有每人只能买一次的限制。

## 一件标价 100 MMT 的 NFT 怎样成交

卖家先授权市场操作 NFT，再 `list(tokenId, 100 MMT)`，NFT 仍留在卖家钱包。白名单买家签署 50 MMT 的 Permit，然后发送一笔 `multicall`：

```text
permitPrePay → Token.permit：建立 50 MMT 扣款额度
claimNFT → 验 proof 和价格上限 → 清挂单 → 付卖家 50 → NFT 给买家
```

假设买家原来 100 MMT，成交后剩 50，拿到 NFT，卖家多 50。原价若为 101 个最小单位，五折实付 51，向上取整；原价 1 也不会变成免费。

买家只发送这一笔购买交易；铸造、分币、卖家授权和上架仍是前置操作，不能一起算作“全流程一笔”。

## 先运行自动闭环

需要 Node.js 24+、npm 和 Foundry。完整仓库提供第 09 项目的合约库；执行网络须支持 Cancun 的瞬态存储重入锁。

从仓库根目录执行：

```bash
cd merkle-nft-market-20
npm ci
npm run check
npm run test:integration
```

check 包含格式/lint、类型、Node 与 Forge 检查；集成测试自己启动独立 Anvil，生成真实签名、成交并核对资产，结束关闭节点。逐步手动运行见 [USAGE](USAGE.md)。2026-10-09 已通过 61 项 Forge 测试；本轮未重跑 TypeScript 购买脚本及 Anvil 集成。

## 为什么两步失败会一起回滚

这里的 `multicall(bytes[])` 是市场的写入入口，它对**自己**执行 delegatecall，保留买家身份与市场存储。不是 Viem 用来批量读取的 `publicClient.multicall()`。

第二步 proof 错误、NFT 拒收或价格超过上限时，会把第一步 allowance 和 Permit nonce 也回滚。不会留下“买失败了但签名已经消耗”的半次成功。

`claimNFT` 的 `maxPayment` 防止签名后卖家提价导致多付。付款 Token 必须是本项目的无转账税、无 rebase Token。

## 再看编码，避免两端算出不同 root

本项目叶子为 `keccak256(bytes.concat(keccak256(abi.encode(account))))`。不是简单对地址文本求哈希，也不是 SHA3-256。

每对 bytes32 节点排序后合并；叶子保留输入顺序，奇数末节点直接晋级。单地址树 proof 为空，root 就是该叶子；空名单、重复地址与零地址会被拒绝。

[merkle.ts](src/merkle.ts) 负责树和 proof；[client.ts](src/client.ts) 编码 Permit 与购买；[市场合约](src/AirdopMerkleNFTMarket.sol) 负责链上核验。两端规则必须完全一致，本格式不等同于任意第三方树的导出格式。

## 出错时怎么理解

- proof 错：先确认地址、root 和编码来自同一份名单。
- Permit 已被提前提交：严格重复调用会失败；检查 allowance 足够后直接 claim，或用新 nonce 重新签名。
- NFT 已不在卖家手里或授权被撤销：挂单不保证一定可成交。
- 同一挂单重复买：应拒绝；同一个人买另一件则未被限购规则禁止。

Gas 对比保留在 [GAS_REPORT](GAS_REPORT.md)；先学会检查钱和 NFT，再研究节省了多少 Gas。

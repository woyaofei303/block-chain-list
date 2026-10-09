# 21 · 可升级市场：地址和账本不变，换一份执行逻辑

普通合约部署后不能直接替换代码。本项目让用户一直访问代理合约，代理把调用交给实现合约；升级时改实现地址，同时保留代理里的 NFT、授权和挂单状态。

先读 [08 的 NFT 市场](../tokenbankv2-08/README.md)、[17 的代理](../meme-factory-17/README.md) 和 [16 的签名](../eip712-permit-16/README.md)。这里分别为 NFT 和市场建立 UUPS 可升级代理。

## 用“柜台、账本、办事规则”理解

代理像固定柜台，账本也放在柜台；实现合约像办事规则。V1 规则只支持原有上架和购买，V2 增加卖家离线签名报价。换规则时，客户仍找原来的柜台。

这个类比有一条重要边界：新旧规则必须以相同方式解释旧账本。若把存储变量随意改顺序、改类型，旧余额可能被当成别的数据。V2 继承 V1 并追加状态，不能重排旧字段。

UUPS 的升级入口放在实现逻辑中，只有 owner 能升级。代理构造时立即初始化，实现本身禁止被初始化；普通 constructor 不会替代理填好状态。

## 用一件 100 Token 的 NFT 看升级前后

卖家在 V1 授权**市场代理**，上架 0 号 NFT，价格 100。升级为 V2 后，市场代理地址不变，`listings(0)` 仍返回原卖家与价格，旧挂单仍能成交。

再出售 1 号时，卖家可签一份订单而不发上架交易。买家带订单与签名调用 `buyWithSignature`，支付 Token、拿到 NFT。离线签名不会写入 `listings`，所以查不到链上挂单不表示签名订单无效。

`setApprovalForAll` 是集合级授权，范围比单枚 approve 大；授权目标保持为代理，升级后无需重新授权。管理员能替换逻辑，因此 owner 是必须信任的角色。

## 先用测试验证状态没有丢

准备 Foundry，从仓库根目录执行：

```bash
cd upgradeable-nft-market-21
forge fmt --check
forge build
forge test -vv
```

本项目保存配套 OpenZeppelin Contracts / Upgradeable 5.7.0，forge-std 复用 09。测试检查升级后的持有人、授权、挂单、权限以及签名和失败回滚。当前配置为 Solidity 0.8.24、Cancun。

进一步按 [USAGE](USAGE.md) 在独立 Anvil 部署 V1、留下状态、升级到 V2 并成交。历史 24 项通过等记录见 [TEST_LOG](TEST_LOG.md)；2026-10-09 已重新运行 24 项 Forge 测试并通过，未重跑手工部署与升级演示。

## 签名订单怎样防止旧报价再次成交

订单包含卖家、tokenId、价格、nonce 和 deadline；签名域还绑定链与**市场代理**。V2 支持普通 EOA 钱包以及 ERC-1271 合约钱包签名验证。

nonce 按“卖家 + NFT”分别记录。成交或 `cancelSignedListing` 会递增它，使旧签名失效；普通上架、撤单、普通成交也会让对应旧签名失效。签名成交还会删除同 NFT 的链上旧挂单。

订单对所有买家开放，不绑定某个买家。同 nonce 签了两份不同价格，也只有先成交的一份有效。NFT 在市场外转走又转回不会自动更新市场 nonce，转出前应撤销旧签名。

## 按这个顺序读代码

1. [NFTMarketV1.sol](src/NFTMarketV1.sol)：初始化和原有交易流程。
2. [NFTMarketV2.sol](src/NFTMarketV2.sol)：`initializeV2 → orderDigest → buyWithSignature`。
3. [UpgradeableNFT.sol](src/UpgradeableNFT.sol)：区分 NFT owner、持有人与升级权限。
4. [测试](test/NFTMarket.t.sol)：观察升级前后查询结果，而不仅是 `version()` 从 1 变 2。
5. [升级脚本](script/UpgradeNFTMarket.s.sol)：升级与 V2 初始化如何一起执行。

付款或 NFT 接收失败，nonce、挂单和资产一起回滚。支付币仅按可信、无转账税、无 rebase 的行为设计。

本项目的“升级”只指自己的代理从 V1 到 V2；不会把 08/11 的普通合约自动升级或迁移进来。元数据仍为教学占位前缀，公共测试网尚无已确认部署地址。

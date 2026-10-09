# 08 · NFT 市场：让付款和交付在一笔交易里完成

目录名保留了早期的 TokenBankV2，但本项目现在讲 **NFTMarket**。TokenBank 全栈已移到 [13](../tokenbank-fullstack-13/README.md)。本课需要先理解 [07 的 ERC20 授权](../tokenbank-07/README.md)；NFT 基础可先读 [11](../erc721-nft-11/README.md)。

## 用 100 枚代币买一件 NFT

ERC20 像同种积分，100 枚可以分开转；ERC721 的每个 `tokenId` 标识一件独立资产。Alice 拥有 0 号 NFT，想收 100 BERC20；Bob 有代币但没有这件 NFT。

市场要保证：成交成功时 Alice 收到 100、Bob 拿到 NFT、挂单消失；如果付款或 NFT 转移失败，则整笔交易回滚。仅有“支付按钮成功”不够，最后应核对两种资产。

## 三个合约分别做什么

- NFT 合约保存 `ownerOf(tokenId)`，即谁拥有哪件 NFT。
- `ERC20WithCallback` 保存支付代币余额，并增加“转账后通知接收合约”的能力。
- `NFTMarket` 保存卖家和报价，绑定前两者，不能拿别的 Token 冒充付款。

上架时 NFT 仍在卖家手中；卖家只把转移权限授给市场。卖家若之后转走 NFT 或取消授权，旧挂单可能无法成交，所以购买时最终转移仍需成功。

## 第一次运行：用测试观察完整买卖

准备 Foundry。保留整个仓库结构，因为映射使用 `foundry-counter-09/lib` 的依赖。从仓库根目录执行：

```bash
cd tokenbankv2-08
forge fmt --check
forge build --sizes
forge test -vv
```

测试在本地 EVM 创建所需资产，不用真实钱包、Base ETH 或已部署 NFT。2026-10-09 已重新运行全部 55 项 Forge 测试并通过；公共链监听未启动。

读 [NFTMarket.t.sol](test/NFTMarket.t.sol)，先找普通成交，再找回调成交与失败断言；每次比较买卖双方余额、NFT 所有者和挂单。

## 同一个例子，两条付款路线

普通购买：Alice 先在 NFT 上授权市场，再 `list(0, price)`；Bob 在支付 Token 上 `approve(市场, price)`，然后在市场 `buyNFT(0)`。市场将代币从 Bob 直接转给 Alice，再转 NFT。

回调购买：Bob 在 Token 上调用 `transferWithCallback(市场, price, data)`。Token 先转钱给市场，再调用 `tokensReceived`；市场核对调用者、金额、NFT 编号后向 Alice 结算并交付 NFT。

```text
普通：Bob → Market.buyNFT → Token.transferFrom(Bob, Alice) → NFT 转给 Bob
回调：Bob → Token.transferWithCallback → Market.tokensReceived → 结算并转 NFT
```

`data` 是按 ABI 编码的 `tokenId`，不是随便填写的字符串。这里固定为 32 字节；ABI 可以理解为双方约定的参数打包规则。回调金额必须恰好等于报价。

两条路线任选其一，不能对同一挂单买两次。`approve` 和 `list` 分别是授权与报价，两者都不代表成交。

## 从结果倒着核验

一笔成功交易后，在无额外转入的干净场景中应看到：

```text
ownerOf(0) = Bob
Alice 的支付代币 +100
Bob 的支付代币 -100
市场未留存本次货款
listings(0) = 零地址, 0
```

回调失败会连同最初转入的代币一起回滚。市场先清除挂单，再进行外部调用，限制同一挂单被回调重复消费；失败时删除也会回滚。

## 深入和实操入口

按 [NFTMarket.sol](src/NFTMarket.sol) 的 `list → buyNFT / tokensReceived → _takeListing` 阅读，再看 [ERC20WithCallback.sol](src/ERC20WithCallback.sol)。

- [逐步操作指南](USAGE.md)：部署脚本、参数、普通/回调购买和成交核对。它包含公共链写入，需自行核对网络、账户与费用。
- [事件监听器](backend/listen-events.mjs)：`npm ci` 后运行 `npm run listen`；配置 `BASE_RPC` 与 `MARKET_ADDRESS`，在操作前启动。监听输出是事件观察，不是订单数据库。
- [优化前报告](gas_report_v1.md)与[优化后报告](gas_report_v2.md)：理解压缩存储为何降低普通上架成本，以及大报价的取舍。

学会的标志：能解释为何 NFT 授权和 ERC20 授权分别发生在不同合约，以及“先转币再回调”失败时为什么不会留下半笔交易。

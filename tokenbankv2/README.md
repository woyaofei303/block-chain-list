# NFTMarket（Foundry）

使用自发行的 ERC20 扩展 Token 买卖一个指定 ERC721 集合，项目使用 Foundry 编译、测试。

题目：[Decert NFTMarket](https://decert.me/challenge/4df553df-fbab-49c8-a05f-83256432c6af)

## 目录

```text
tokenbankv2/
├── src/
│   ├── BaseERC20.sol
│   ├── ERC20WithCallback.sol
│   └── NFTMarket.sol
├── test/
│   └── NFTMarket.t.sol
├── foundry.toml
└── remappings.txt
```

## 功能

- `ERC20WithCallback`：继承自发行的 `BaseERC20`，部署者获得固定发行的 BERC20，并提供带 `bytes data` 的回调转账。
- `list(tokenId, price)`：NFT 持有人授权市场后，以 ERC20 最小单位设置价格并上架。
- `buyNFT(tokenId)`：买家先授权 ERC20，市场收取 Token 并转移 NFT。
- `tokensReceived(from, amount, data)`：接收扩展 Token 的回调并完成购买，`data` 为 `abi.encode(tokenId)`。

普通购买：

```solidity
nft.approve(address(market), tokenId);
market.list(tokenId, price);

token.approve(address(market), price);
market.buyNFT(tokenId);
```

回调购买：

```solidity
token.transferWithCallback(address(market), price, abi.encode(tokenId));
```

## Foundry 验证

```bash
cd tokenbankv2
forge fmt --check
forge build --sizes
forge test -vv
```

测试覆盖上架、普通购买、回调购买、NFT 授权、价格、回调来源和回调数据校验。

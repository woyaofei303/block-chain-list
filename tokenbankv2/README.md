# NFTMarket（Foundry）

本目录新增了 [Token Bank 前端](frontend/README.md)，通过现有 `erc20-event-indexer` 后端展示转账记录。部署银行、配置索引器与前端、存取款、记录确认、发布及排障的完整流程见该说明；下文保留 NFTMarket 原有操作流程。

使用自发行的 ERC20 扩展 Token 买卖指定 ERC721 集合。合约使用 Foundry：`forge` 负责编译、测试和部署，`cast` 负责链上读取与交易；后台使用 Viem 监听上架和成交事件。

题目：[Decert NFTMarket](https://decert.me/challenge/4df553df-fbab-49c8-a05f-83256432c6af)

## 题目功能

- `list(tokenId, price)`：NFT 持有人授权市场后设置 BERC20 价格并上架。
- `buyNFT(tokenId)`：买家授权 BERC20 后完成普通购买。
- `tokensReceived(from, amount, data)`：接收扩展 Token 回调并完成购买，`data = abi.encode(tokenId)`。
- `transferWithCallback(to, amount, data)`：先转入 Token，再同步调用接收合约；回调失败时整笔交易回滚。
- `NFTListed`、`NFTSold`：分别记录上架与成交，普通购买和回调购买使用同一个成交事件。

## 项目结构

```text
tokenbankv2/
├── src/
│   ├── BaseERC20.sol
│   ├── ERC20WithCallback.sol
│   └── NFTMarket.sol
├── script/
│   └── DeployNFTMarket.s.sol
├── backend/
│   └── listen-events.mjs
├── test/
│   └── NFTMarket.t.sol
├── foundry.toml
├── package.json
├── package-lock.json
└── remappings.txt
```

## 整体流程闭环

```text
卖家部署 ERC20WithCallback
        ↓
卖家部署 NFTMarket(Token 地址, NFT 地址)
        ↓
后台启动 Viem 监听 NFTMarket 新区块事件
        ↓
卖家给买家分发 BERC20
        ↓
卖家授权 NFTMarket 并调用 list(tokenId, price)
        ↓
合约写入 listings，发出 NFTListed
        ↓
Viem 打印上架日志
        ↓
买家选择 buyNFT 普通购买
或 transferWithCallback 回调购买
        ↓
合约清除挂单、向卖家结算 BERC20、向买家转移 NFT
        ↓
合约发出 NFTSold，Viem 打印成交日志
        ↓
最终状态：卖家收到款、买家拥有 NFT、市场无余额、挂单已清除
```

这条链路从链上操作开始，以链上状态完成和链下日志可见结束。普通购买与回调购买只有付款入口不同，最终都进入同一成交结果；任一步失败时整笔交易回滚，不会出现只付款未收到 NFT 或只转 NFT 未付款的中间状态。

以下示例连接已经发布的 Base 主网 NFT：

```text
NFT：0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7
卖家：0x2d09486837737d793406CE743b94F1A0A1e7eD1e
买家：0xFB88273c712f4E6Ce8Fa571885eeE9ccb706af8a
```

所有带 `--broadcast` 或 `cast send` 的命令都会发送真实 Base 主网交易。不要在命令、`.env`、源码或聊天中填写私钥；示例使用 Foundry 加密 keystore。

## 0. 首次环境准备

### 0.1 安装 Foundry

未安装 Foundry 时执行：

```bash
curl -L https://foundry.paradigm.xyz | bash
```

重新打开终端，然后执行：

```bash
foundryup
forge --version
cast --version
```

### 0.2 获取代码

第一次下载：

```bash
git clone https://github.com/woyaofei303/block-chain-list.git
cd block-chain-list/tokenbankv2
```

已经下载过则更新后进入目录：

```bash
cd block-chain-list
git pull --ff-only
cd tokenbankv2
```

### 0.3 导入卖家和买家钱包

先查看本机已有的加密钱包：

```bash
cast wallet list
```

仅在对应钱包不存在时导入。命令会在隐藏输入框中要求输入私钥和 keystore 密码：

```bash
cast wallet import blocklight-deployer --interactive
cast wallet import blocklight-buyer --interactive
```

不要使用 `--private-key` 把私钥直接写入命令历史。

## 1. 设置执行变量

```bash
cd tokenbankv2

export BASE_RPC='https://mainnet.base.org'
export NFT_ADDRESS='0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7'
export SELLER='0x2d09486837737d793406CE743b94F1A0A1e7eD1e'
export BUYER='0xFB88273c712f4E6Ce8Fa571885eeE9ccb706af8a'

export SELLER_ACCOUNT='blocklight-deployer'
export BUYER_ACCOUNT='blocklight-buyer'

export TOKEN_ID='0'
export PRICE='100000000000000000000'
```

`PRICE` 是 100 BERC20，BERC20 使用 18 位精度。若要交易 Token ID 1 或 2，只修改 `TOKEN_ID`。

确认当前目录和价格：

```bash
pwd
cast to-unit "$PRICE" ether
```

价格换算结果应为 `100`。

## 2. 连接和钱包检查

确认连接的是 Base 主网，Chain ID 必须为 `8453`：

```bash
cast chain-id --rpc-url "$BASE_RPC"
cast block-number --rpc-url "$BASE_RPC"
```

确认 keystore 对应正确地址：

```bash
cast wallet address --account "$SELLER_ACCOUNT"
cast wallet address --account "$BUYER_ACCOUNT"
```

输出必须分别等于 `$SELLER` 和 `$BUYER`。如果不一致，停止执行并检查 keystore 名称。

确认两个钱包都有 Base ETH 支付 Gas：

```bash
cast balance "$SELLER" --rpc-url "$BASE_RPC" --ether
cast balance "$BUYER" --rpc-url "$BASE_RPC" --ether
```

确认 NFT 合约存在，并且准备出售的 NFT 当前属于卖家：

```bash
cast code "$NFT_ADDRESS" --rpc-url "$BASE_RPC"
cast call "$NFT_ADDRESS" 'ownerOf(uint256)(address)' "$TOKEN_ID" --rpc-url "$BASE_RPC"
```

`ownerOf` 必须返回 `$SELLER`。

如果买家没有 Gas，可由卖家按需转入少量 Base ETH；下面命令会发送真实 ETH：

```bash
cast send "$BUYER" \
  --value 0.00005ether \
  --rpc-url "$BASE_RPC" \
  --account "$SELLER_ACCOUNT"

cast balance "$BUYER" --rpc-url "$BASE_RPC" --ether
```

## 3. 编译和测试

```bash
forge fmt --check
forge build --sizes
forge test -vv
```

期望结果是编译成功，测试显示 `11 passed, 0 failed`。任何一步失败都不要继续主网广播。

## 4. 模拟并部署 BERC20 与 NFTMarket

部署脚本会创建两个合约：

1. `ERC20WithCallback`：固定发行 100,000,000 BERC20 给部署者。
2. `NFTMarket`：绑定新 Token 与 `$NFT_ADDRESS`。

先模拟，不广播：

```bash
forge script script/DeployNFTMarket.s.sol:DeployNFTMarket \
  --rpc-url "$BASE_RPC" \
  --sender "$SELLER" \
  -vvv
```

模拟成功后再广播：

```bash
forge script script/DeployNFTMarket.s.sol:DeployNFTMarket \
  --rpc-url "$BASE_RPC" \
  --sender "$SELLER" \
  --account "$SELLER_ACCOUNT" \
  --broadcast \
  -vvv
```

输入卖家 keystore 密码后，等待两笔部署交易确认。脚本应输出：

```text
ERC20WithCallback 0x...
NFTMarket 0x...
```

如果广播中断，在确认前一次交易状态后使用原命令追加 `--resume`，不要直接重新部署：

```bash
forge script script/DeployNFTMarket.s.sol:DeployNFTMarket \
  --rpc-url "$BASE_RPC" \
  --sender "$SELLER" \
  --account "$SELLER_ACCOUNT" \
  --broadcast \
  --resume \
  -vvv
```

也可以从本地广播记录中核对合约地址和交易哈希：

```bash
rg '"contractName"|"contractAddress"|"hash"' \
  broadcast/DeployNFTMarket.s.sol/8453/run-latest.json
```

把脚本输出的两个地址保存：

```bash
export TOKEN_ADDRESS='0x替换成ERC20WithCallback地址'
export MARKET_ADDRESS='0x替换成NFTMarket地址'
```

核对合约代码和绑定关系：

```bash
cast code "$TOKEN_ADDRESS" --rpc-url "$BASE_RPC"
cast code "$MARKET_ADDRESS" --rpc-url "$BASE_RPC"
cast call "$MARKET_ADDRESS" 'paymentToken()(address)' --rpc-url "$BASE_RPC"
cast call "$MARKET_ADDRESS" 'nft()(address)' --rpc-url "$BASE_RPC"
```

后两项必须分别返回 `$TOKEN_ADDRESS` 和 `$NFT_ADDRESS`。

确认新发行的 Token 全部在卖家地址：

```bash
cast call "$TOKEN_ADDRESS" 'name()(string)' --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'symbol()(string)' --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'decimals()(uint8)' --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'totalSupply()(uint256)' --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$SELLER" --rpc-url "$BASE_RPC"
```

## 5. 卖家给买家分发 BERC20

新发行的 BERC20 全部属于卖家。为演示购买，卖家先给买家转入刚好 100 BERC20：

```bash
cast send "$TOKEN_ADDRESS" \
  'transfer(address,uint256)' \
  "$BUYER" \
  "$PRICE" \
  --rpc-url "$BASE_RPC" \
  --account "$SELLER_ACCOUNT"
```

确认买家已收到 100 BERC20：

```bash
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BUYER" --rpc-url "$BASE_RPC"
```

返回值必须等于 `$PRICE`。

## 6. 卖家授权并上架 NFT

卖家授权市场转移 NFT：

```bash
cast send "$NFT_ADDRESS" \
  'approve(address,uint256)' \
  "$MARKET_ADDRESS" \
  "$TOKEN_ID" \
  --rpc-url "$BASE_RPC" \
  --account "$SELLER_ACCOUNT"
```

卖家以 100 BERC20 上架：

```bash
cast send "$MARKET_ADDRESS" \
  'list(uint256,uint256)' \
  "$TOKEN_ID" \
  "$PRICE" \
  --rpc-url "$BASE_RPC" \
  --account "$SELLER_ACCOUNT"
```

检查买家余额、NFT 授权和挂单：

```bash
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BUYER" --rpc-url "$BASE_RPC"
cast call "$NFT_ADDRESS" 'getApproved(uint256)(address)' "$TOKEN_ID" --rpc-url "$BASE_RPC"
cast call "$MARKET_ADDRESS" 'listings(uint256)(address,uint256)' "$TOKEN_ID" --rpc-url "$BASE_RPC"
```

挂单结果必须是卖家地址和 `$PRICE`。从下一步开始只选择 `7A` 或 `7B` 中的一种执行。

## 7A. 普通购买

普通购买需要两笔买家交易。第一笔授权市场扣除 100 BERC20：

```bash
cast send "$TOKEN_ADDRESS" \
  'approve(address,uint256)' \
  "$MARKET_ADDRESS" \
  "$PRICE" \
  --rpc-url "$BASE_RPC" \
  --account "$BUYER_ACCOUNT"
```

确认授权额度：

```bash
cast call "$TOKEN_ADDRESS" \
  'allowance(address,address)(uint256)' \
  "$BUYER" \
  "$MARKET_ADDRESS" \
  --rpc-url "$BASE_RPC"
```

返回值必须等于 `$PRICE`。

先用 `eth_call` 模拟完整购买，不改变链上状态：

```bash
cast call "$MARKET_ADDRESS" \
  'buyNFT(uint256)' \
  "$TOKEN_ID" \
  --from "$BUYER" \
  --rpc-url "$BASE_RPC"
```

模拟成功后广播购买：

```bash
cast send "$MARKET_ADDRESS" \
  'buyNFT(uint256)' \
  "$TOKEN_ID" \
  --rpc-url "$BASE_RPC" \
  --account "$BUYER_ACCOUNT"
```

## 7B. 回调购买

回调购买和普通购买二选一，同一个 NFT 不能购买两次。回调路径不需要买家调用 `approve`，只需一笔买家交易。

编码 Token ID：

```bash
export CALLBACK_DATA="$(cast abi-encode 'f(uint256)' "$TOKEN_ID")"
```

先模拟完整回调购买：

```bash
cast call "$TOKEN_ADDRESS" \
  'transferWithCallback(address,uint256,bytes)(bool)' \
  "$MARKET_ADDRESS" \
  "$PRICE" \
  "$CALLBACK_DATA" \
  --from "$BUYER" \
  --rpc-url "$BASE_RPC"
```

模拟成功后广播：

```bash
cast send "$TOKEN_ADDRESS" \
  'transferWithCallback(address,uint256,bytes)' \
  "$MARKET_ADDRESS" \
  "$PRICE" \
  "$CALLBACK_DATA" \
  --rpc-url "$BASE_RPC" \
  --account "$BUYER_ACCOUNT"
```

回调交易内部顺序：

```text
ERC20WithCallback：买家 → NFTMarket
NFTMarket.tokensReceived：校验 Token、金额和 tokenId
NFTMarket：BERC20 → 卖家
NFTMarket：NFT → 买家
```

任一步失败，BERC20 转账、NFT 转移和挂单删除都会整体回滚。

## 8. 成交验收

```bash
cast call "$NFT_ADDRESS" 'ownerOf(uint256)(address)' "$TOKEN_ID" --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$SELLER" --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BUYER" --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$MARKET_ADDRESS" --rpc-url "$BASE_RPC"
cast call "$MARKET_ADDRESS" 'listings(uint256)(address,uint256)' "$TOKEN_ID" --rpc-url "$BASE_RPC"
```

期望结果：

```text
NFT ownerOf(tokenId) = BUYER
卖家 BERC20 增加 PRICE
买家 BERC20 减少 PRICE
NFTMarket BERC20 余额 = 0
listings(tokenId) = address(0), 0
```

生成区块浏览器和 OpenSea 链接：

```bash
printf 'Token:  https://basescan.org/address/%s\n' "$TOKEN_ADDRESS"
printf 'Market: https://basescan.org/address/%s\n' "$MARKET_ADDRESS"
printf 'NFT:    https://opensea.io/item/base/%s/%s\n' "$NFT_ADDRESS" "$TOKEN_ID"
```

## 9. 完整交易数量

从全新部署到成交，需要的 Base 主网交易如下：

```text
卖家交易 1：部署 ERC20WithCallback
卖家交易 2：部署 NFTMarket
卖家交易 3：转 100 BERC20 给买家
卖家交易 4：授权 NFTMarket 操作 NFT
卖家交易 5：上架 NFT

普通购买：
买家交易 1：授权 NFTMarket 使用 100 BERC20
买家交易 2：调用 buyNFT

回调购买：
买家交易 1：调用 transferWithCallback
```

买家充值 Base ETH 是可选的额外交易。普通购买与回调购买不能对同一挂单同时执行。

OpenSea 只展示最终链上所有权；本项目的 BERC20 挂单和成交发生在自定义 NFTMarket 中，并不是 OpenSea 挂单。

Token ID 0：<https://opensea.io/item/base/0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7/0>

## 10. 使用 Viem 监听上架和成交事件

另开一个终端，在执行上架或购买前启动监听器：

```bash
cd tokenbankv2
node --version
npm install

export BASE_RPC='https://mainnet.base.org'
export MARKET_ADDRESS='0x替换成NFTMarket地址'
npm run listen
```

监听器需要 Node.js 18.17 或更高版本。

发生上架或成交后，终端会分别打印 `NFTListed` 或 `NFTSold` 的 JSON 日志，包括卖家、买家、Token ID、价格和交易哈希。按 `Ctrl+C` 停止监听。

## 11. 买家将 NFT 卖回给卖家

首次成交后，原买家 `$BUYER` 持有 NFT，原卖家 `$SELLER` 持有 BERC20。反向交易继续使用同一个 `$TOKEN_ADDRESS`、`$MARKET_ADDRESS` 和 `$NFT_ADDRESS`，无需重新部署合约。本节仍沿用前文变量名，但交易角色已经互换：原买家负责上架，原卖家负责购买。

先确认 NFT 所有权、原卖家的 BERC20 余额以及双方的 Gas 余额：

```bash
cast call "$NFT_ADDRESS" 'ownerOf(uint256)(address)' "$TOKEN_ID" --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$SELLER" --rpc-url "$BASE_RPC"
cast balance "$BUYER" --rpc-url "$BASE_RPC" --ether
cast balance "$SELLER" --rpc-url "$BASE_RPC" --ether
```

`ownerOf` 必须返回 `$BUYER`，且 `$SELLER` 的 BERC20 余额不能小于 `$PRICE`。

原买家授权市场转移 NFT，然后以相同价格重新上架：

```bash
cast send "$NFT_ADDRESS" \
  'approve(address,uint256)' \
  "$MARKET_ADDRESS" \
  "$TOKEN_ID" \
  --rpc-url "$BASE_RPC" \
  --account "$BUYER_ACCOUNT"

cast send "$MARKET_ADDRESS" \
  'list(uint256,uint256)' \
  "$TOKEN_ID" \
  "$PRICE" \
  --rpc-url "$BASE_RPC" \
  --account "$BUYER_ACCOUNT"
```

确认挂单中的卖家是 `$BUYER`，价格是 `$PRICE`：

```bash
cast call "$MARKET_ADDRESS" \
  'listings(uint256)(address,uint256)' \
  "$TOKEN_ID" \
  --rpc-url "$BASE_RPC"
```

从下面的 `11A` 和 `11B` 中选择一种方式买回，同一个挂单不能执行两次。

### 11A. 原卖家普通买回

原卖家先授权市场使用 BERC20：

```bash
cast send "$TOKEN_ADDRESS" \
  'approve(address,uint256)' \
  "$MARKET_ADDRESS" \
  "$PRICE" \
  --rpc-url "$BASE_RPC" \
  --account "$SELLER_ACCOUNT"
```

模拟成功后再广播购买：

```bash
cast call "$MARKET_ADDRESS" \
  'buyNFT(uint256)' \
  "$TOKEN_ID" \
  --from "$SELLER" \
  --rpc-url "$BASE_RPC"

cast send "$MARKET_ADDRESS" \
  'buyNFT(uint256)' \
  "$TOKEN_ID" \
  --rpc-url "$BASE_RPC" \
  --account "$SELLER_ACCOUNT"
```

### 11B. 原卖家通过回调买回

回调购买不需要 `approve` BERC20，只发送一笔买回交易：

```bash
export CALLBACK_DATA="$(cast abi-encode 'f(uint256)' "$TOKEN_ID")"

cast call "$TOKEN_ADDRESS" \
  'transferWithCallback(address,uint256,bytes)(bool)' \
  "$MARKET_ADDRESS" \
  "$PRICE" \
  "$CALLBACK_DATA" \
  --from "$SELLER" \
  --rpc-url "$BASE_RPC"

cast send "$TOKEN_ADDRESS" \
  'transferWithCallback(address,uint256,bytes)' \
  "$MARKET_ADDRESS" \
  "$PRICE" \
  "$CALLBACK_DATA" \
  --rpc-url "$BASE_RPC" \
  --account "$SELLER_ACCOUNT"
```

最后验收反向成交：

```bash
cast call "$NFT_ADDRESS" 'ownerOf(uint256)(address)' "$TOKEN_ID" --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$SELLER" --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BUYER" --rpc-url "$BASE_RPC"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$MARKET_ADDRESS" --rpc-url "$BASE_RPC"
cast call "$MARKET_ADDRESS" 'listings(uint256)(address,uint256)' "$TOKEN_ID" --rpc-url "$BASE_RPC"
```

期望 NFT 所有者重新变为 `$SELLER`，原买家收到 `$PRICE`，市场的 BERC20 余额为 `0`，挂单被清除。若监听器已在正确的 `$MARKET_ADDRESS` 上运行，会依次打印新的 `NFTListed` 和 `NFTSold`。

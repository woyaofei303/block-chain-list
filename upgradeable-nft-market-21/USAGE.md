# 可升级 NFT 市场：部署、保留旧挂单、升级后成交

先读 [README](README.md)。本篇用同一个市场代理贯穿 V1 与 V2：先留下挂单，再升级逻辑，查询旧状态，最后用签名报价成交另一件 NFT。

始终分清代理地址与实现地址：用户、Token 授权、NFT 授权和签名域都面向代理；实现地址用于检查升级到了哪份代码。模拟地址不代表实际部署，广播后从本轮记录取地址。

本地命令默认仅使用 Anvil 解锁账户；最后的 Sepolia 模板属于单独公共链操作。原有公共测试网广播尚未执行，本次文档重构也没有执行。历史验证见 [TEST_LOG](TEST_LOG.md)。

## 1. 本地 Anvil：先 V1，再升级

### 1.1 启动独立链

终端 A，执行目录为本项目；先确认端口未被占用。若已占用，不要杀未知进程，另选端口并同步所有 RPC 参数。结束实验后只停止自己启动的 Anvil。

```bash
lsof -nP -iTCP:18545 -sTCP:LISTEN
anvil --host 127.0.0.1 --port 18545 --chain-id 31337 --silent
```

终端 B，执行目录为本项目：

```bash
export RPC_URL='http://127.0.0.1:18545'
export EXPECTED_CHAIN_ID=31337
export DEPLOYER=$(cast rpc eth_accounts --rpc-url "$RPC_URL" | jq -r '.[0]')
export BUYER=$(cast rpc eth_accounts --rpc-url "$RPC_URL" | jq -r '.[1]')
cast chain-id --rpc-url "$RPC_URL"
```

### 1.2 模拟、广播与获取地址

```bash
forge script script/DeployNFTMarket.s.sol:DeployNFTMarket \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER"

forge script script/DeployNFTMarket.s.sol:DeployNFTMarket \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" --unlocked --broadcast

export DEPLOY_LOG='../output-tdd/upgradeable-nft-market-21/broadcast/DeployNFTMarket.s.sol/31337/run-latest.json'
export PAYMENT_TOKEN=$(jq -r '.transactions[] | select(.contractName=="MarketToken") | .contractAddress' "$DEPLOY_LOG")
export NFT_IMPLEMENTATION=$(jq -r '.transactions[] | select(.contractName=="UpgradeableNFT") | .contractAddress' "$DEPLOY_LOG")
export MARKET_V1=$(jq -r '.transactions[] | select(.contractName=="NFTMarketV1") | .contractAddress' "$DEPLOY_LOG")
export NFT_PROXY=$(jq -r '[.transactions[] | select(.contractName=="ERC1967Proxy")][0].contractAddress' "$DEPLOY_LOG")
export MARKET_PROXY=$(jq -r '[.transactions[] | select(.contractName=="ERC1967Proxy")][1].contractAddress' "$DEPLOY_LOG")

cast call "$MARKET_PROXY" 'version()(uint256)' --rpc-url "$RPC_URL"
cast call "$MARKET_PROXY" 'owner()(address)' --rpc-url "$RPC_URL"
cast call "$MARKET_PROXY" 'nft()(address)' --rpc-url "$RPC_URL"
cast call "$MARKET_PROXY" 'paymentToken()(address)' --rpc-url "$RPC_URL"
```

预期版本 `1`、管理员 `$DEPLOYER`、绑定资产与上面地址相同。`--unlocked` 只用于此本地 Anvil。

### 1.3 铸造、一次授权、V1 上架

```bash
export PRICE=100000000000000000000
cast send "$NFT_PROXY" 'mint(address,uint256)' "$DEPLOYER" 1 --rpc-url "$RPC_URL" --from "$DEPLOYER" --unlocked
cast send "$NFT_PROXY" 'mint(address,uint256)' "$DEPLOYER" 2 --rpc-url "$RPC_URL" --from "$DEPLOYER" --unlocked
cast send "$NFT_PROXY" 'setApprovalForAll(address,bool)' "$MARKET_PROXY" true --rpc-url "$RPC_URL" --from "$DEPLOYER" --unlocked
cast send "$MARKET_PROXY" 'list(uint256,uint256)' 1 "$PRICE" --rpc-url "$RPC_URL" --from "$DEPLOYER" --unlocked
cast send "$PAYMENT_TOKEN" 'transfer(address,uint256)' "$BUYER" 1000000000000000000000 --rpc-url "$RPC_URL" --from "$DEPLOYER" --unlocked
cast send "$PAYMENT_TOKEN" 'approve(address,uint256)' "$MARKET_PROXY" 1000000000000000000000 --rpc-url "$RPC_URL" --from "$BUYER" --unlocked
cast call "$MARKET_PROXY" 'listings(uint256)(address,uint256)' 1 --rpc-url "$RPC_URL"
```

预期挂单为 `$DEPLOYER`、`100000000000000000000`（100 MKT）。

### 1.4 升级后核验原状态，并买下旧挂单

```bash
forge script script/UpgradeNFTMarket.s.sol:UpgradeNFTMarket \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER"
forge script script/UpgradeNFTMarket.s.sol:UpgradeNFTMarket \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" --unlocked --broadcast

export UPGRADE_LOG='../output-tdd/upgradeable-nft-market-21/broadcast/UpgradeNFTMarket.s.sol/31337/run-latest.json'
export MARKET_V2=$(jq -r '.transactions[] | select(.contractName=="NFTMarketV2") | .contractAddress' "$UPGRADE_LOG")
cast call "$MARKET_PROXY" 'version()(uint256)' --rpc-url "$RPC_URL"
cast call "$MARKET_PROXY" 'listings(uint256)(address,uint256)' 1 --rpc-url "$RPC_URL"
cast call "$NFT_PROXY" 'isApprovedForAll(address,address)(bool)' "$DEPLOYER" "$MARKET_PROXY" --rpc-url "$RPC_URL"
cast implementation "$MARKET_PROXY" --rpc-url "$RPC_URL"
cast send "$MARKET_PROXY" 'buyNFT(uint256)' 1 --rpc-url "$RPC_URL" --from "$BUYER" --unlocked
cast call "$NFT_PROXY" 'ownerOf(uint256)(address)' 1 --rpc-url "$RPC_URL"
```

预期版本 `2`，原报价不变，集合授权仍为 `true`，实现地址变为 `$MARKET_V2`，购买后 tokenId 1 属于 `$BUYER`。不要对已经升级的代理重新执行升级脚本；脚本会以 `Expected V1` 拒绝。

## 2. 离线签名上架 tokenId 2

继续上一节的本地环境。此前 tokenId 2 未调用 `list`，也不需要再次授权 NFT。下面用 Anvil 的虚拟钱包 RPC 演示 `eth_signTypedData_v4`；真实钱包应由卖家在自己的钱包中审核并签名，不能使用公共 RPC 的解锁账户。

```bash
export TOKEN_ID=2
export NONCE=$(cast call "$MARKET_PROXY" 'nonces(address,uint256)(uint256)' "$DEPLOYER" "$TOKEN_ID" --rpc-url "$RPC_URL")
export DEADLINE=$(($(date +%s) + 3600))
export ORDER_JSON=$(jq -nc \
  --arg seller "$DEPLOYER" --arg market "$MARKET_PROXY" \
  --arg tokenId "$TOKEN_ID" --arg price "$PRICE" --arg nonce "$NONCE" --arg deadline "$DEADLINE" \
  '{types:{EIP712Domain:[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],SignedListing:[{name:"seller",type:"address"},{name:"tokenId",type:"uint256"},{name:"price",type:"uint256"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}]},primaryType:"SignedListing",domain:{name:"UpgradeableNFTMarket",version:"2",chainId:31337,verifyingContract:$market},message:{seller:$seller,tokenId:$tokenId,price:$price,nonce:$nonce,deadline:$deadline}}')
export SIGNATURE=$(cast rpc eth_signTypedData_v4 "$DEPLOYER" "$ORDER_JSON" --rpc-url "$RPC_URL" | jq -r '.')

cast send "$MARKET_PROXY" \
  'buyWithSignature((address,uint256,uint256,uint256,uint256),bytes)' \
  "($DEPLOYER,$TOKEN_ID,$PRICE,$NONCE,$DEADLINE)" "$SIGNATURE" \
  --rpc-url "$RPC_URL" --from "$BUYER" --unlocked

cast call "$NFT_PROXY" 'ownerOf(uint256)(address)' 2 --rpc-url "$RPC_URL"
cast call "$MARKET_PROXY" 'nonces(address,uint256)(uint256)' "$DEPLOYER" 2 --rpc-url "$RPC_URL"
cast call "$PAYMENT_TOKEN" 'balanceOf(address)(uint256)' "$BUYER" --rpc-url "$RPC_URL"
cast call "$PAYMENT_TOKEN" 'balanceOf(address)(uint256)' "$MARKET_PROXY" --rpc-url "$RPC_URL"
```

预期 NFT 属于买家、nonce 从 0 变成 1、买家余额为 800 MKT、市场余额为 0。再次提交相同订单应报 `Invalid nonce`。

尚未成交时，卖家可用 `cancelSignedListing(tokenId)` 取消签名。`cancelListing(tokenId)` 用于已有链上挂单。更改网络时必须同时更改 typed data 的 `chainId` 和代理地址；不要对 EIP-712 摘要再套 `personal_sign` 前缀。

V1 回调购买是普通购买的替代方式，不能在同一 NFT 已成交后再执行：

```bash
cast send "$PAYMENT_TOKEN" 'transferWithCallback(address,uint256,bytes)' \
  "$MARKET_PROXY" "$PRICE" "$(cast abi-encode 'f(uint256)' "$TOKEN_ID")" \
  --rpc-url "$RPC_URL" --from "$BUYER" --unlocked
```

需要该 NFT 仍有链上挂单；回调金额必须恰好等于报价。

## 3. Sepolia 广播与浏览器验证（待实际执行）

历史项目 `bank-tokenbank-tests-10` 使用 Sepolia（`11155111`）、公开 RPC `https://ethereum-sepolia-rpc.publicnode.com` 和 `sepolia-deployer` keystore 别名。本机同时有 `sepolia-deployer-2`。旧文档公开钱包地址为 `0x000071424bb08b910f0786e04D964A63D64bF1Ba`；本次只读余额约为 `0.294644861637109919` Sepolia ETH。keystore 没有明文 address 字段，尚未确认这两个别名与旧钱包的对应关系。

本次以旧公开地址进行的**未广播模拟**成功：五笔部署交易估算 `5,251,410 gas`，当时最大费用 `1.934394444 gwei`，约 `0.01015829832716604 ETH`；升级还需两笔交易，费用随网络变化。不得把模拟生成的预测地址填入下方已部署地址清单。

实际广播前应先用自己的终端解锁 keystore 取得公开地址，并确认本次部署账户及费用上限。不要把密码或私钥发送给 Codex。以下命令执行目录仍为本项目；只有明确授权本次测试网部署后才执行带 `--broadcast` 的命令。

```bash
export DEPLOYER_ACCOUNT=sepolia-deployer
export DEPLOYER=$(cast wallet address --account "$DEPLOYER_ACCOUNT")
export RPC_URL='https://ethereum-sepolia-rpc.publicnode.com'
export EXPECTED_CHAIN_ID=11155111
cast chain-id --rpc-url "$RPC_URL"
cast balance "$DEPLOYER" --ether --rpc-url "$RPC_URL"

forge script script/DeployNFTMarket.s.sol:DeployNFTMarket \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER"

forge script script/DeployNFTMarket.s.sol:DeployNFTMarket \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" --account "$DEPLOYER_ACCOUNT" --broadcast
```

从 `../output-tdd/upgradeable-nft-market-21/broadcast/DeployNFTMarket.s.sol/11155111/run-latest.json` 按第 1.2 节相同的 jq 命令提取五个地址（更新 `$DEPLOY_LOG`），然后模拟并广播升级：

```bash
forge script script/UpgradeNFTMarket.s.sol:UpgradeNFTMarket \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER"
forge script script/UpgradeNFTMarket.s.sol:UpgradeNFTMarket \
  --rpc-url "$RPC_URL" --sender "$DEPLOYER" --account "$DEPLOYER_ACCOUNT" --broadcast
```

从对应 `UpgradeNFTMarket.s.sol/11155111/run-latest.json` 提取 `$MARKET_V2`。广播超时先检查记录和交易回执，不重复部署；不要未经核验把 `--resume` 当成重试按钮。

可用无 API key 的 Sepolia Blockscout 验证六个地址。`forge verify-contract` 会使用当前项目的编译设置；代理必须提供各自正确的实现地址与初始化 calldata（市场代理构造参数仍是 **V1**）。

```bash
export VERIFY_URL='https://eth-sepolia.blockscout.com/api/'
forge verify-contract "$PAYMENT_TOKEN" src/MarketToken.sol:MarketToken --chain 11155111 --verifier blockscout --verifier-url "$VERIFY_URL" --watch
forge verify-contract "$NFT_IMPLEMENTATION" src/UpgradeableNFT.sol:UpgradeableNFT --chain 11155111 --verifier blockscout --verifier-url "$VERIFY_URL" --watch
forge verify-contract "$MARKET_V1" src/NFTMarketV1.sol:NFTMarketV1 --chain 11155111 --verifier blockscout --verifier-url "$VERIFY_URL" --watch
forge verify-contract "$MARKET_V2" src/NFTMarketV2.sol:NFTMarketV2 --chain 11155111 --verifier blockscout --verifier-url "$VERIFY_URL" --watch

export NFT_INIT=$(cast calldata 'initialize(address,string,string,string)' "$DEPLOYER" 'Upgradeable NFT' 'UNFT' 'https://example.com/nft/')
export MARKET_INIT=$(cast calldata 'initialize(address,address,address)' "$PAYMENT_TOKEN" "$NFT_PROXY" "$DEPLOYER")
forge verify-contract "$NFT_PROXY" lib/openzeppelin-contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy \
  --constructor-args "$(cast abi-encode 'f(address,bytes)' "$NFT_IMPLEMENTATION" "$NFT_INIT")" \
  --chain 11155111 --verifier blockscout --verifier-url "$VERIFY_URL" --watch
forge verify-contract "$MARKET_PROXY" lib/openzeppelin-contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy \
  --constructor-args "$(cast abi-encode 'f(address,bytes)' "$MARKET_V1" "$MARKET_INIT")" \
  --chain 11155111 --verifier blockscout --verifier-url "$VERIFY_URL" --watch
```

验证后核对回执 `status=1`、两个代理的 `owner()`、市场 `version()=2`、资产绑定及 `cast implementation`；在浏览器逐个确认已验证源码，而不是只存在地址页面。

### 测试网地址记录

```text
网络：Sepolia（11155111）
支付币：待部署
ERC721 代理：待部署
ERC721 实现：待部署
NFTMarket 代理：待部署
NFTMarket V1 实现：待部署
NFTMarket V2 实现：待部署
升级交易：待广播
浏览器源码验证：待执行
```

这里必须填真实广播回执中的地址及浏览器链接。代码与文档发布到 GitHub 不代表合约已部署；测试网状态仍以上面的实际广播与验证记录为准。

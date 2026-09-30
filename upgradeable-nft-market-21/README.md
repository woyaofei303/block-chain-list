# 可升级 NFT Market：UUPS、状态保留与离线签名

本题实现可升级 ERC721、NFTMarket V1/V2、升级测试和 Foundry 部署/升级脚本。V2 卖家只需一次 `setApprovalForAll`（题面 `setApproveAll` 的标准名称），以后每枚 NFT 用 EIP-712 签名报价，买家携签名一笔成交。

**交付状态（2026-09-30）：本地实现、24 项测试、存储布局比较、Anvil 实际部署/升级/成交、Sepolia 只读部署模拟已完成；公共测试网广播与浏览器验证尚未执行。没有已部署测试网地址，模拟地址不作为作业答案。** 完整实测输出见 [TEST_LOG.md](TEST_LOG.md)。

## 1. 题面与实现边界

- 基础挑战：[Solidity 实现用 Token 购买 NFT](https://learnblockchain.cn/quest/5f11aa15-b101-480b-91b5-4888b9aafdbb)。已读取其[完整题目](https://learnblockchain.cn/quest/5f11aa15-b101-480b-91b5-4888b9aafdbb/challenging)：第 1 题为 ERC721、图片/元数据去中心化存储及 OpenSea 展示；第 2 题要求使用自己发行的 Token，通过 `list()` 定价上架、`buyNFT()` 按价购买。本次可升级市场 V1 以其中第 2 题和仓库已有 NFT 购买流程为基础；本次新增要求是 ERC721/市场可升级，以及市场 V2 离线签名上架。
- NFT 与市场各有一个 `ERC1967Proxy`，各自管理员控制 UUPS 升级。只给**代理**授权；升级不改变代理地址，不需要重新 `setApprovalForAll`。
- V1 指定一个 NFT 集合及一个固定供应的 18 位 ERC20；挂单记录卖家与完整 `uint256` 价格，NFT 留在卖家钱包。任一步结算失败，资金、NFT、挂单和 nonce 一起回滚。
- V2 继承 V1，追加 `nonces[seller][tokenId]`。`buyWithSignature` 即离线订单的链上结算入口：签名挂单本身不发交易、不写 `listings`；签名可经任意链下渠道交给买家。没有额外的卖家链上“提交签名上架”步骤。
- `cancelSignedListing` 作废当前 nonce 的所有签名报价；V2 的普通上架、取消链上挂单和普通成交也会使对应旧签名失效。签名成交删除同 tokenId 的链上旧挂单，防止残留报价。
- 签名包含 `seller/tokenId/price/nonce/deadline`，域包含链 ID、代理地址、名称和版本。支持 EOA 与 ERC-1271。价格与 tokenId 是题目要求，其他字段用于域隔离、撤销、过期与重放保护。

### 与仓库已有 NFT 购买项目的对应关系

- 基础市场是 [`tokenbankv2-08/src/NFTMarket.sol`](../tokenbankv2-08/src/NFTMarket.sol)：卖家授权 NFT → `list(tokenId, price)` → 买家授权 ERC20 → `buyNFT(tokenId)` → 卖家收款、买家获得 NFT、清空挂单。这里的 [NFTMarketV1](src/NFTMarketV1.sol) 保留这条业务流程及 `listings(tokenId)` 查询，改为代理初始化和 UUPS 升级，并使用 SafeERC20、重入锁及安全 NFT 转移完成结算。
- 08 已有的 `transferWithCallback` → `tokensReceived` 购买方式也保留；这是原仓库的附加能力，不是该基础挑战第 2 题的必选要求。支付币仍为本项目自行发行的 ERC20，普通购买和回调购买共用结算规则。
- 原 NFT 集合、IPFS 资源及 OpenSea 展示见 [`erc721-nft-11`](../erc721-nft-11/README.md)；本题另提供 [UpgradeableNFT](src/UpgradeableNFT.sol)，验证 ERC721 在代理升级后保留持有人、授权和元数据配置。新代理使用的元数据前缀仍为占位值，原项目的展示链接不代表新代理已经发布到 OpenSea。
- [NFTMarketV2](src/NFTMarketV2.sol) 在可升级 V1 上增加签名订单：卖家一次授权市场代理，之后离线报价，买家调用 `buyWithSignature` 成交；V1 两种购买入口继续可用。

08 的旧市场和 11 的旧 NFT 是普通部署，不能直接升级成 UUPS。这里的“升级前后状态一致”指 **本项目同一个代理中的 V1 → V2**，不是自动迁移旧合约的挂单或 NFT。按仓库独立练习编号规则将可升级版本放在 `upgradeable-nft-market-21`，基础项目继续作为原流程的复习入口。

限制：支付币须是可信、无扣税/无 rebasing 的 ERC20，回调路径要求固定支付币真实转入金额。管理员可升级全部逻辑，属于可信角色。元数据 URI 是教学占位前缀，没有上传真实图片。订单对所有买家开放；同 nonce 的多个报价只有一份能成交。NFT 在市场外转走又转回不会自动递增市场 nonce，转出前应取消仍有效的旧签名；撤销集合授权可暂停交易，但恢复授权不会自动使旧签名过期。时间戳只用于到期校验，不用于随机数。

## 2. 阅读顺序与依赖

1. `src/UpgradeableNFT.sol`：初始化、管理员铸造、UUPS 升级；`setApprovalForAll`、URI 和转账来自标准 ERC721。
2. `src/MarketToken.sol`：固定供应支付币及带数据的转账回调。
3. `src/NFTMarketV1.sol`：上架、取消、两种购买方式，共用验证与结算。
4. `src/NFTMarketV2.sol`：EIP-712 域、签名验证、nonce 消耗/取消、兼容 V1。
5. `test/NFTMarket.t.sol`：真实代理升级、资产与权限、签名边界、回滚和重入测试。
6. `script/DeployNFTMarket.s.sol` / `script/UpgradeNFTMarket.s.sol`：五笔部署交易、两笔升级交易。

Solidity `0.8.24`，EVM `cancun`，优化开启 `200 runs`。`forge-std` 复用仓库 09。`lib/` 固定保存官方 npm `@openzeppelin/contracts@5.7.0` 与 `@openzeppelin/contracts-upgradeable@5.7.0` 的必要原始文件，保留许可和压缩包 integrity；没有额外 npm 安装步骤。仓库共享 Contracts 快照的接口命名与 npm Upgradeable 不兼容，因此不修改共享库，使用本项目成对固定版本。

依赖机制参考 [OpenZeppelin UUPS 文档](https://docs.openzeppelin.com/contracts/5.x/api/proxy) 与 [可升级合约说明](https://docs.openzeppelin.com/contracts/5.x/upgradeable)。实现构造器 `_disableInitializers`，代理构造交易内 `initialize`；V2 通过 `upgradeToAndCall(..., initializeV2())` 原子初始化签名域。OZ 依赖使用独立存储命名空间，V1 自有字段位于 slot 0–2，V2 仅追加 slot 3 的 nonce。

## 3. 编译和测试

以下命令从仓库根目录进入项目；需要已安装 `forge`、`cast`、`anvil`、`jq`，不需要私钥。

```bash
cd upgradeable-nft-market-21
forge fmt --check
forge build
forge test -vv
forge inspect NFTMarketV1 storage-layout
forge inspect NFTMarketV2 storage-layout
```

预期：24 项测试通过，其中随机金额用例执行 256 轮。升级测试分别证明市场和 ERC721 的所有权、管理员、URI、挂单、授权、余额等保留；市场原挂单在 V2 仍可正常成交。测试中 NFT 的 V2 只是版本探针，不是需要部署到测试网的另一个业务版本。

保留完整测试日志且不掩盖 Forge 退出码：

```bash
mkdir -p ../output-tdd/upgradeable-nft-market-21
forge test -vv > ../output-tdd/upgradeable-nft-market-21/test.log 2>&1
TEST_EXIT=$?
cat ../output-tdd/upgradeable-nft-market-21/test.log
test "$TEST_EXIT" -eq 0
```

构建的静态 lint 提示与处理说明见 [TEST_LOG.md](TEST_LOG.md)，不将编译成功称为零告警。

## 4. 本地 Anvil：先 V1，再升级

### 4.1 启动独立链

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

### 4.2 模拟、广播与获取地址

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

### 4.3 铸造、一次授权、V1 上架

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

### 4.4 升级后核验原状态，并买下旧挂单

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

## 5. 离线签名上架 tokenId 2

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

## 6. Sepolia 广播与浏览器验证（待实际执行）

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

从 `../output-tdd/upgradeable-nft-market-21/broadcast/DeployNFTMarket.s.sol/11155111/run-latest.json` 按第 4.2 节相同的 jq 命令提取五个地址（更新 `$DEPLOY_LOG`），然后模拟并广播升级：

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

# Blocklight Genesis

一个部署到 Base 主网的三枚 ERC-721 NFT 系列。

- 合约名称：`Blocklight Genesis`
- Symbol：`BLGT`
- 网络：Base mainnet（chain ID `8453`）
- 合约地址：`0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7`
- BaseScan：`https://basescan.org/address/0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7`
- 实际总 Gas：`0.000009128901238838 ETH`
- 接收钱包：`0x2d09486837737d793406CE743b94F1A0A1e7eD1e`
- NFT：`Genesis Pulse`、`Consensus Bloom`、`Finality Horizon`
- 图片目录 CID：`bafybeif7vyzmweiktki4uwkng37hyhnbfwvzendmvf7gk2sx4deiw6oo34`
- Metadata 目录 CID：`bafybeie7gq5vhwhomhlyi3unvihjeopo3d7gpdwlzoqdliv5rdnyvnhwwi`

## 本地验证

```bash
forge fmt --check
forge build --sizes
forge test -vv
```

## 钱包

在用户可见的终端中创建加密钱包：

```bash
cast wallet new ~/.foundry/keystores blocklight-deployer --touch-id
```

备份加密 keystore 与密码，并分开保存。不要把私钥、助记词、钱包密码或 Pinata Token 放入 `.env`、源码、Shell 历史或聊天。

## IPFS 上传顺序

1. 将 `assets/images/` 作为目录上传到 Pinata Public IPFS。
2. 把返回的图片目录 CID 写入 `metadata/0.json`、`1.json`、`2.json` 的 `image` 字段。
3. 验证 JSON 与图片链接。
4. 将 `metadata/` 作为目录上传到 Pinata Public IPFS。
5. 记录返回的 Metadata CID。

## 部署前模拟

```bash
export NFT_OWNER='0x2d09486837737d793406CE743b94F1A0A1e7eD1e'
export METADATA_CID='bafybeie7gq5vhwhomhlyi3unvihjeopo3d7gpdwlzoqdliv5rdnyvnhwwi'

forge script script/DeployAndMint.s.sol:DeployAndMint \
  --rpc-url base \
  --sender "$NFT_OWNER" \
  -vvv

cast gas-price --rpc-url https://mainnet.base.org
cast balance "$NFT_OWNER" --rpc-url https://mainnet.base.org --ether
```

模拟成功并获得用户对费用和四笔交易的明确确认前，不得广播。

## Base 主网部署

```bash
forge script script/DeployAndMint.s.sol:DeployAndMint \
  --rpc-url base \
  --account blocklight-deployer \
  --sender "$NFT_OWNER" \
  --broadcast \
  --verify \
  --verifier sourcify \
  --slow \
  -vvv
```

该命令部署一次合约并执行三次铸造。若中途失败，先检查 `broadcast/DeployAndMint.s.sol/8453/run-latest.json`，确认不会重复交易后才可考虑 `--resume`。

## 链上检查

```bash
export CONTRACT_ADDRESS='0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7'

cast code "$CONTRACT_ADDRESS" --rpc-url https://mainnet.base.org
cast call "$CONTRACT_ADDRESS" 'ownerOf(uint256)(address)' 0 --rpc-url https://mainnet.base.org
cast call "$CONTRACT_ADDRESS" 'ownerOf(uint256)(address)' 1 --rpc-url https://mainnet.base.org
cast call "$CONTRACT_ADDRESS" 'ownerOf(uint256)(address)' 2 --rpc-url https://mainnet.base.org
cast call "$CONTRACT_ADDRESS" 'tokenURI(uint256)(string)' 0 --rpc-url https://mainnet.base.org
cast call "$CONTRACT_ADDRESS" 'tokenURI(uint256)(string)' 1 --rpc-url https://mainnet.base.org
cast call "$CONTRACT_ADDRESS" 'tokenURI(uint256)(string)' 2 --rpc-url https://mainnet.base.org
```

## OpenSea

```text
https://opensea.io/item/base/0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7/0
https://opensea.io/item/base/0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7/1
https://opensea.io/item/base/0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7/2
```

## BaseScan 交易

```text
https://basescan.org/tx/0xf94e12f0b3999f1b404a21b565b096dbdff0f4afd1244882e3587f96839264de
https://basescan.org/tx/0x7c0b224324c270b15f12388aed5219f5d7e8b0fbc79a7621e1ad1d8e9550a830
https://basescan.org/tx/0xfc56544f246b49f161e4c09bbdfd16a9d8a0536538669acd04743d81451ce75f
https://basescan.org/tx/0xdcee81958a89c859a47582f8867faaa783844ce07f2e74061f6e2650bb758460
```

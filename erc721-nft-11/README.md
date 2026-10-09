# 11 · NFT 从哪里来：编号、图片和元数据

这个项目把三张作品做成 ERC721 NFT。你会理解：链上记录“谁拥有哪个编号”，图片和介绍放在链外，再用一个地址把它们连起来。

## 用 0 号作品理解三层关系

```text
ownerOf(0) → 0 号 NFT 当前所有者
tokenURI(0) → ipfs://<元数据目录CID>/0.json
0.json 的 image → ipfs://<图片目录CID>/<图片文件名>
```

元数据是描述作品的 JSON，包含名称、介绍和图片位置。CID 是 IPFS 根据内容生成的标识；内容变了，CID 通常也变。NFT 编号不是图片文件，钱包展示图片也不意味着图片全部存进区块链。

ERC721 的 0 号和 1 号是不同资产，不像 ERC20 的两枚代币可以直接视为同一单位。`owner()` 是合约管理员，`ownerOf(0)` 是作品持有人，两者可能不同。

## 先在本地验证合约

准备 Foundry，从仓库根目录执行：

```bash
cd erc721-nft-11
forge fmt --check
forge build --sizes
forge test -vv
```

测试在临时 EVM 中运行，不上传 IPFS、不铸造公共链 NFT。第三方合约来自 `foundry-counter-09/lib`，需要保留仓库目录结构。2026-10-09 已通过 4 项 Forge 测试。

[BlocklightGenesis.sol](src/BlocklightGenesis.sol) 的 `safeMint(to, uri)` 仅允许合约 owner 调用，编号从 0 逐次增加。接收方是合约时会检查 ERC721 接收能力，失败则铸造回滚。

历史上发行了三枚，但**合约没有把最大供应量限制为三枚**。三枚来自下面部署脚本调用三次，不是不可更改的供应上限。

## 图片与元数据要按顺序准备

1. 查看本项目 `assets/images/`，确认三张图片。
2. 上传图片目录到 IPFS，取得图片目录 CID；上传是外部写入，使用自己的服务账户。
3. 修改 `metadata/0.json`、`1.json`、`2.json` 中的 `image`，使其指向图片目录里的真实文件。
4. 检查 JSON 语法和图片能否读取，再上传 metadata 目录，取得另一个 CID。
5. 合约铸造时写入 metadata 的 CID，不能误填图片 CID。

在本项目目录只检查 JSON 格式，可执行：

```bash
python3 -m json.tool metadata/0.json > /dev/null
python3 -m json.tool metadata/1.json > /dev/null
python3 -m json.tool metadata/2.json > /dev/null
```

格式正确只说明 JSON 可解析，仍需检查 `image` 的实际内容和可访问性。首次理解源码不需要重新上传已有作品。

## 只模拟一次“部署 + 三次铸造”

下面 sender 是公开的本地测试地址；没有 `--rpc-url`、没有 `--broadcast`，只运行临时 EVM。仍在本项目目录执行：

```bash
export NFT_OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export METADATA_CID=bafybeie7gq5vhwhomhlyi3unvihjeopo3d7gpdwlzoqdliv5rdnyvnhwwi
forge script script/DeployAndMint.s.sol:DeployAndMint --sender "$NFT_OWNER" -vvv
```

[DeployAndMint.s.sol](script/DeployAndMint.s.sol) 先创建合约，再给 owner 铸造 0、1、2 号。sender 必须能通过 `onlyOwner` 检查；模拟地址不会自动出现在 Base 主网上。

公共链部署使用同一个脚本，但需要另行选择真实网络、本人账户、费用和上传结果。广播过程中若某笔失败，先核对回执和 `broadcast/` 记录；多笔部署/铸造不是一笔跨交易原子操作，不能直接从头重发。

## 只读核对历史 NFT

下面只读取 Base 主网，不会转账：

```bash
export NFT_CONTRACT=0x37d8c1cCBd16FbD28d561eAcEeb711008F03d1f7
cast call "$NFT_CONTRACT" 'ownerOf(uint256)(address)' 0 --rpc-url https://mainnet.base.org
cast call "$NFT_CONTRACT" 'tokenURI(uint256)(string)' 0 --rpc-url https://mainnet.base.org
```

如果图片不显示，沿 `tokenURI → JSON → image` 一层层检查；如果所有者不同，先确认链与合约地址。市场页面缓存不等于链上当前状态。

## 历史部署资料

以下地址、Gas 和交易来自原有记录，本次未重新查询或部署，不代表当前所有权仍等于最初接收者。

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

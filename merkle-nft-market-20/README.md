# Merkle 白名单 + Permit + Multicall NFT 市场

实现题目中的 `AirdopMerkleNFTMarket`（保留原拼写）：白名单买家用上架价格的 50% Token 购买 NFT，一笔交易中通过 `delegatecall` 顺序执行 `permitPrePay()` 和 `claimNFT()`。

题目依据本次提供的原文；[之前的上架题目](https://decert.me/challenge/5f11aa15-b101-480b-91b5-4888b9aafdbb)在本环境未能读取正文，因此沿用仓库第 08 / 16 题的非托管上架行为：持有人先授权市场，再调用 `list(tokenId, price)`；上架时 NFT 留在卖家钱包，重复上架更新价格，成交时才转移。新项目不导入兄弟项目的业务源码。

## 代码阅读顺序

1. [PermitToken.sol](src/PermitToken.sol)：OpenZeppelin ERC20Permit，18 位精度，部署者获得固定 1,000,000 MMT。
2. [MarketNFT.sol](src/MarketNFT.sol)：ERC721，仅 owner 可铸造，编号从 0 开始。
3. [AirdopMerkleNFTMarket.sol](src/AirdopMerkleNFTMarket.sol)：挂单、白名单证明、Permit 和五折结算。
4. [merkle.ts](src/merkle.ts)：地址校验、树构建、root 与每个地址的 proof 输出。
5. [client.ts](src/client.ts)：EIP-2612 typed data 与两步 multicall 的交易编码。
6. [Deploy.s.sol](script/Deploy.s.sol) → [demo.ts](script/demo.ts)：部署脚本与真实 RPC 购买示例。
7. [合约测试](test/AirdopMerkleNFTMarket.t.sol)、[树测试](test/merkle.test.ts)、[Anvil 集成测试](test/market.integration.ts)。

## 一笔购买如何完成

```text
卖家：NFT.approve(market, tokenId) → market.list(tokenId, 100 MMT)
买家：离线签署 Token Permit（owner=买家，spender=市场，value=50 MMT）
买家：发送一笔 market.multicall([permitData, claimData]) 交易
  ├─ delegatecall permitPrePay：Token.permit 建立 50 MMT 额度
  └─ delegatecall claimNFT：校验买家 proof → 清挂单 → 扣 50 MMT 给卖家 → NFT 给买家
```

合约继承仓库已有的 [OpenZeppelin Multicall](../foundry-counter-09/lib/openzeppelin-contracts/contracts/utils/Multicall.sol)。其内部使用 `Address.functionDelegateCall(address(this), data[i])`：调用目标始终是市场自身，两个子调用的 `msg.sender` 都是原买家，存储也属于市场。任意一步失败会原样抛出错误，连同 Token allowance、Permit nonce、付款与 NFT 转移整体回滚。

这里调用的是**市场的写入交易 `multicall(bytes[])`**，不是 Viem 用于批量读取的 `publicClient.multicall()`。买家离线签名不发交易，最终购买发一笔交易并支付 Gas；部署、铸造、分币和卖家授权/上架是前置交易。

`client.ts` 的核心用法（在有钱包客户端的调用方中执行）：

```typescript
const signature = await wallet.signTypedData({
  account: buyer,
  ...permitTypedData({ token, chainId, owner: buyer, market, value, nonce, deadline }),
})
const call = encodePermitClaim({ market, tokenId, value, deadline, signature, proof })
await publicClient.call({ account: buyer, ...call })
const hash = await wallet.sendTransaction({ account: buyer, ...call })
await publicClient.waitForTransactionReceipt({ hash })
```

此片段展示接口，完整变量初始化、回执判断和成交断言见可直接运行的 `script/demo.ts`。`nonce` 从 Token 读取，`deadline` 按链上区块时间计算，金额为 `bigint`。签名域固定为 `Merkle Market Token / 1 / chainId / Token 地址`；此封装针对本项目 Token。

## Merkle 编码与实现选择

叶子使用双哈希，Solidity 与 TypeScript 完全一致：

```solidity
keccak256(bytes.concat(keccak256(abi.encode(account))))
```

- 先 ABI 编码为 32 字节地址，再做两次 Keccak256；不是 `abi.encodePacked(address)`，也不是 SHA3-256。
- 叶子保留输入地址顺序，每对节点按 bytes32 大小排序后拼接哈希；奇数末节点直接晋级，proof 不添加不存在的兄弟节点。
- 单地址树的 root 等于该地址叶子，proof 为空。拒绝空白名单、重复地址、零地址和无效地址。
- 可由 OpenZeppelin `MerkleProof.verifyCalldata` 验证；这是本项目的树布局与 JSON 格式，不声称与 `StandardMerkleTree` 的树布局或 dump 格式相同。
- Token、NFT 和 root 在部署后固定；白名单只有地址资格，不限定每人只能买一次。
- 挂单价格保持完整 `uint256`。五折支付 `price / 2 + price % 2`，奇数最小单位向上取整；原价 1 不会免费，最大整数不会溢出。
- `claimNFT(tokenId, maxPayment, proof)` 的最高实付额防止签名后提价；封装将它设为本次 Permit 金额。
- 只提供白名单购买入口，不增加全价购买、费用抽成、可更新根或前端页面。卖家可更新报价，或撤销 NFT 授权使挂单暂时无法成交；本练习没有独立撤单接口。
- `safeTransferFrom` 保证合约接收者能接收 NFT；购买、上架和 Permit 入口有重入锁。最外层 multicall 不加同一把锁，否则会阻塞内部受保护的顺序调用。

EIP-2612 Permit 可被任何人提前提交给 Token。这里严格执行 Permit，重复签名会失败；若已提前提交，买家确认 `allowance >= 实付金额` 后可直接调用 `claimNFT`，或读取新 nonce 重新签名。测试包含前一种恢复路径。标准 ERC20Permit 使用 EOA 签名；合约钱包可用普通 approve 后调用 claim，本项目不扩展 ERC-1271 Permit。

仅支持本项目不收转账费、不 rebase 的支付 Token。白名单证明不是秘密，安全性依赖于 `msg.sender` 绑定，而非隐藏 proof。本题未做独立安全审计。

## 安装与自动检查

需要 Node.js 24+、npm、Foundry（forge / cast / anvil）。从**仓库根目录**执行：

```bash
cd merkle-nft-market-20
npm ci
npm run check
npm run test:integration
```

`npm run check` 执行 Biome 格式/lint、TypeScript strict、Node 测试、Forge 格式、编译与合约测试。集成测试自动启动随机端口的独立 Anvil，执行 `forge script` 模拟和广播，校验全部三个地址的链上 Merkle proof、RPC Permit 签名、一笔 multicall 成交及重复演示拒绝，最后关闭自己创建的进程。

版本固定在配置与锁文件中：Solidity 0.8.24 / Cancun，Node 24，Viem 2.56.7。OpenZeppelin 5.7.0 与 forge-std 复用完整仓库中 `foundry-counter-09/lib` 的已保存源码；不要只下载本目录，也无需初始化子模块或重新下载合约依赖。

共享 Husky 钩子保持 `multi-chat-py-01/web/.husky/_`，本项目有暂存变更时运行 `npm run precommit`，先 lint-staged，再类型检查、Node 测试和 Forge 检查。RPC 集成测试单独运行，避免每次提交启动节点。

## 从零运行本地演示

以下命令除特别说明外都在 **`merkle-nft-market-20/` 项目目录**执行。只用本机 Anvil 解锁账户，不读取或填写私钥。脚本只允许 chain ID 31337；它不会向公共链部署。

### 1. 启动独立 Anvil

先检查端口，若有已有进程不要停止它；选择空闲端口并同步后续 RPC。终端 A：

```bash
lsof -nP -iTCP:8549 -sTCP:LISTEN
anvil --host 127.0.0.1 --port 8549 --chain-id 31337 --silent
```

`--silent` 避免输出测试私钥。保持终端运行，结束演示后在该终端按 Ctrl-C 关闭自己的节点。

### 2. 构建三地址白名单

终端 B 设置 Anvil 默认公开地址；这里账户 0 是卖家，账户 1 是买家，账户 1 / 2 / 3 按此顺序构成白名单：

```bash
export RPC_URL=http://127.0.0.1:8549
export DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
export BUYER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
export MEMBER2=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
export MEMBER3=0x90F79bf6EB2c4f870365E785982E1f101E93b906
cast chain-id --rpc-url "$RPC_URL"
cast rpc eth_accounts --rpc-url "$RPC_URL"
mkdir -p ../output-tdd/merkle-nft-market-20
node src/merkle.ts "$BUYER" "$MEMBER2" "$MEMBER3" > ../output-tdd/merkle-nft-market-20/whitelist.json
cat ../output-tdd/merkle-nft-market-20/whitelist.json
export MERKLE_ROOT="$(node -p "require('../output-tdd/merkle-nft-market-20/whitelist.json').root")"
```

核对 chain ID 为 `31337`，前四个 RPC 账户与上方一致。默认白名单的 root 应为：

```text
0x77b9302d7f6b7e4ae4d11aa2d7e38b5d628b0024993dc171d6b95059d0f11d57
```

### 3. 模拟，再部署三个合约

先模拟，不改变链上状态：

```bash
forge script script/Deploy.s.sol:Deploy \
  --sig 'run(address,bytes32)' "$DEPLOYER" "$MERKLE_ROOT" \
  --sender "$DEPLOYER" --rpc-url "$RPC_URL"
```

模拟成功后向本地链广播：

```bash
forge script script/Deploy.s.sol:Deploy \
  --sig 'run(address,bytes32)' "$DEPLOYER" "$MERKLE_ROOT" \
  --sender "$DEPLOYER" --rpc-url "$RPC_URL" \
  --unlocked --broadcast --slow
```

从**成功广播记录**获取市场地址，再从市场读取绑定关系，不把模拟地址当部署证据：

```bash
export MARKET_ADDRESS="$(node -p "require('./broadcast/Deploy.s.sol/31337/run-latest.json').transactions.find(t => t.contractName === 'AirdopMerkleNFTMarket').contractAddress")"
export TOKEN_ADDRESS="$(cast call "$MARKET_ADDRESS" 'paymentToken()(address)' --rpc-url "$RPC_URL")"
export NFT_ADDRESS="$(cast call "$MARKET_ADDRESS" 'nft()(address)' --rpc-url "$RPC_URL")"
cast code "$MARKET_ADDRESS" --rpc-url "$RPC_URL"
cast call "$MARKET_ADDRESS" 'merkleRoot()(bytes32)' --rpc-url "$RPC_URL"
```

广播中断时先检查该记录与交易回执，不直接重跑部署。此演示不自动恢复半完成的前置操作。

### 4. 铸造、分币、上架和一笔购买

只在上一步的**全新部署**上执行一次：

```bash
npm run demo -- "$RPC_URL" "$MARKET_ADDRESS"
```

脚本按顺序铸造 NFT #0 给卖家、分发 100 MMT 给买家、卖家授权并以 100 MMT 上架；买家经 RPC 签署 50 MMT Permit，模拟后发送一笔 multicall，最后对余额、NFT、nonce 和挂单做断言。脚本检测到已有 NFT 会在写入前停止，避免重复铸造或充值。输出包含公开地址、购买交易哈希、Gas 和前后状态，不输出签名或密钥。

### 5. 独立核验最终状态

```bash
cast call "$NFT_ADDRESS" 'ownerOf(uint256)(address)' 0 --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BUYER" --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$DEPLOYER" --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$MARKET_ADDRESS" --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'allowance(address,address)(uint256)' "$BUYER" "$MARKET_ADDRESS" --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'nonces(address)(uint256)' "$BUYER" --rpc-url "$RPC_URL"
cast call "$MARKET_ADDRESS" 'listings(uint256)(address,uint256)' 0 --rpc-url "$RPC_URL"
cast nonce "$BUYER" --rpc-url "$RPC_URL"
```

全新 Anvil 的预期结果：NFT #0 属于买家；买家 50 MMT，卖家 999,950 MMT，市场 0；allowance 0，Token Permit nonce 1，挂单 `(address(0), 0)`；买家交易 nonce 为 1。这与“买家只发送一笔交易”相对应。

## 验证记录与范围

2026-09-29，本机 Node 24.14.0 / Foundry 1.8.1 / Solidity 0.8.24 / Anvil 31337：已运行部署模拟、本地广播及 TypeScript 完整购买；买家确实只发出一笔交易，100 MMT 挂单以 50 MMT 成交。这里的地址、交易哈希与余额仅是本地模拟环境，不是公共链记录。

合约测试覆盖上架权限与授权、白名单与无效 proof、Permit 身份/金额/域/过期/重放、提前提交后的 claim 恢复、改价上限、额度/余额不足、撤销 NFT 授权、陈旧挂单、重复购买整批回滚、奇数和最大报价、接收回调重入及拒收回滚；另有 256 轮价格 fuzz。本次实测 23 项 Forge 测试、2 项 Node 测试及 1 项 Anvil 集成测试全部通过；Biome、严格类型检查、Forge 格式/构建与共享 pre-commit 通过。Forge 构建仍输出风格建议及测试代码的 lint 提示，不影响编译和行为测试。共享钩子使用临时 Git index 实测，真实暂存区保持不变。

本地验证不包含公共链部署或课程答案提交。GitHub 提交作业应指向实际推送后的本项目目录或具体提交；本地文件存在不代表远程已经更新。

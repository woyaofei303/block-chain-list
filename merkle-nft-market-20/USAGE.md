# Merkle 市场：从白名单文件到一笔成交

先读 [README](README.md)。本篇按“生成名单 → 部署 root → 准备 NFT 与代币 → 签名购买 → 核对余额”执行，示例原价 100 MMT，实付 50。

所有广播仅面向本机 Anvil。Merkle proof 是资格证明，Permit 是扣款授权，multicall 是把两个合约操作打包；它们分别解决不同问题。文末历史结果保留原日期，本次文档重构未重新测量。

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

初版（`d4767afd`）于 2026-09-29，本机 Node 24.14.0 / Foundry 1.8.1 / Solidity 0.8.24 / Anvil 31337：已运行部署模拟、本地广播及 TypeScript 完整购买；买家确实只发出一笔交易，100 MMT 挂单以 50 MMT 成交。这里的地址、交易哈希与余额仅是本地模拟环境，不是公共链记录。

合约测试覆盖上架权限与授权、白名单与无效 proof、Permit 身份/金额/域/过期/重放、提前提交后的 claim 恢复、改价上限、额度/余额不足、撤销 NFT 授权、陈旧挂单、重复购买整批回滚、奇数和最大报价、接收回调重入及拒收回滚；另有 256 轮价格 fuzz。该轮历史实测 23 项 Forge 测试、2 项 Node 测试及 1 项 Anvil 集成测试全部通过；Biome、严格类型检查、Forge 格式/构建与共享 pre-commit 通过。Forge 构建仍输出风格建议及测试代码的 lint 提示，不影响编译和行为测试。共享钩子使用临时 Git index 实测，真实暂存区保持不变。

本地验证不包含公共链部署或课程答案提交。GitHub 提交作业应指向实际推送后的本项目目录或具体提交；本地文件存在不代表远程已经更新。


## Gas 优化

优化结果、成本取舍和复现命令见 [GAS_REPORT.md](GAS_REPORT.md)：普通首次上架降低 30.10%，Permit + multicall 购买降低 6.90%，部署增加 1.37%（同场景 Foundry 读数）。复用 OpenZeppelin 瞬态锁与第 08 题的单槽挂单方案；Token、NFT、白名单哈希、Permit、multicall、公开函数/事件及回滚消息保持不变。源码不跨项目引用业务实现。

[冻结 v1](test/fixtures/AirdopMerkleNFTMarketV1.sol) 与当前合约共享行为和 Gas 场景。此改动改变内部存储布局，适用于新部署，不能直接替换旧部署的字节码或当作代理升级。已有地址也不会因本地修改自动省 Gas。

合约保留已提交的第一轮版本，ABI 不变；客户端调整后的验证记录见 Gas 报告。

### 不增加部署成本的客户端优化

第二轮评估后已还原新增批量合约入口及独立签名挂单合约。当前只保留 `preparePurchase()`：额度足够时跳过 Permit，多件商品用已有 `multicall` 执行一次总预算 Permit 和多次 `claimNFT`，**无需重新部署合约**。这不会把 proof 验证搬到链下，链上仍逐件校验并原子结算。

```ts
import { preparePurchase } from './src/client.ts'

const call = await preparePurchase({
  publicClient, wallet, buyer, market, proof,
  items: [
    { tokenId: 1n, maxPayment: 50n * 10n ** 18n },
    { tokenId: 2n, maxPayment: 50n * 10n ** 18n },
  ],
})
// 封装只读取、签名和模拟；由调用方明确发送并等待回执。
const hash = await wallet.sendTransaction({ account: buyer, ...call })
```

金额使用最小单位 bigint，拒绝空购物车、重复编号和预算溢出。已有额度必须本来就存在；为本次购买先单独 approve 再购买通常更贵，因此不自动扩大或创建额度。保留原 `encodePermitClaim()` 供题目两步调用使用。当前成本、还原依据和实测见 [划算性复核](GAS_REPORT.md#第二轮划算性复核与还原)。

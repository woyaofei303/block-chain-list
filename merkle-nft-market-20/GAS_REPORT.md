# Merkle NFT Market Gas 优化对比

2026-09-29，本地 Foundry 1.8.1 / Solidity 0.8.24 / Cancun，optimizer=true、runs=200，未开启 via-IR。无公共链广播。

## 修改与收益

1. `ReentrancyGuard` 换为仓库已有的 `ReentrancyGuardTransient`，避免每个入口读写永久存储锁。`list`、`permitPrePay` 和 `claimNFT` 仍全部防重入；每步返回立即解锁，所以顺序 multicall 可继续执行。网络必须支持 EIP-1153。
2. 复用第 08 题的 `address + uint96` 单槽挂单布局。普通报价少写一个存储槽；`2^96-1` 及以上报价通过标记和扩展映射保存，仍支持整个 uint256 范围。改回小额和成交时清理扩展状态。

只改市场实现；Token、NFT、Merkle 哈希、Permit 内容、五折舍入、最高支付额和 delegatecall Multicall 保持不变。已核对两版完整 ABI 相等，原事件及回滚消息保留。没有为了 Gas 删除签名、证明、权限、回滚或重入检查。

## 相同场景实测

| 场景 | 优化前 Gas | 优化后 Gas | 变化 |
| --- | ---: | ---: | ---: |
| 普通首次上架 | 79,377 | 55,488 | -30.10% |
| 普通改价 | 42,377 | 38,388 | -9.41% |
| Permit + multicall 购买 | 147,144 | 136,993 | -6.90% |
| 已有额度的 claim | 101,332 | 97,576 | -3.71% |
| 最大 uint256 首次上架 | 79,677 | 77,852 | -2.29% |
| 最大报价改回普通价 | 42,377 | 38,656 | -8.78% |
| 市场部署 | 970,550 | 983,827 | +1.37% |

部署增加 13,277 Gas（1.37%）；普通首次上架节省 23,889 Gas，已超过该次额外部署成本。最终收益取决于实际调用次数、报价路径、证明长度和链的费用规则，不能直接换算成固定 ETH 费用。

单独使用瞬态锁、尚未压缩挂单时，multicall 为 141,063 Gas，较初版少 4.13%；最终结合两项优化为上表结果。

## 计量边界

- [冻结 v1](test/fixtures/AirdopMerkleNFTMarketV1.sol) 来自提交 `d4767afd`，仅改合约名和基线注释；不用于部署。
- [共同测试](test/AirdopMerkleNFTMarket.t.sol) 的两个子类仅替换部署版本，场景与断言共享。普通报价 100 MMT，更新到 200 MMT，购买支付 50 MMT；白名单是两个地址，proof 含一个兄弟节点。
- 使用 `--isolate` 将顶层调用按独立交易执行，避免前置授权/上架预热槽位；`--no-dynamic-test-linking` 避免动态链接使部署成本失真。
- 上表来自 `vm.lastFrameGas().gasTotalUsed`，包括该业务帧的下游调用，排除测试准备、签名生成和断言；`[PASS] (gas: ...)` 是整个测试开销，不能拿来代替业务调用。
- 同时保留 Foundry 的 `gasRefunded` 原始读数，不从上表重复减退款。以下是「优化前 / 优化后」读数：

```text
list.first.refund: 2800 / 0
list.update.refund: 2800 / 0
buy.multicall.refund: 36786 / 34248
buy.claim.refund: 25332 / 19200
list.extended.refund: 2800 / 0
list.extendedToSmall.refund: 2800 / 4800
deploy.market.refund: 0 / 0
```

- Gas 用途不同，分开列部署、上架、改价和购买，不用混合均值声称每次交易都同幅下降。已有授权的 claim 不包含之前 approve 的成本。
- 需在新部署使用：内部存储布局发生变化，不能直接替换现有代理实现；源码优化不会改变旧合约。未做公共链费用验证或独立安全审计。

## 复现

从仓库根目录进入项目，两版用同一条命令：

```bash
cd merkle-nft-market-20
forge test --match-test '^testGas' --gas-report --isolate --no-dynamic-test-linking -vv
forge test --isolate --no-dynamic-test-linking --fuzz-seed 0x712
npm run check
npm run test:integration
```

输出较长时保存到忽略目录并保留命令退出码；本次原始日志位于 `../output-tdd/merkle-nft-market-20/gas/`，克隆后可用上述命令重新生成。

Gas 回归测试要求在相同冷槽条件下，普通首次上架至少比 v1 省 20%。优化前实测该断言失败，两项优化后通过。行为测试另覆盖标记两侧、最大报价、大小报价切换、扩展报价成交，以及既有签名、回滚、重入路径。

## 本次验证

- `npm run check` 通过：Biome、TypeScript strict、2 项 Node 测试、Forge 格式/编译及 61 项合约测试（当前实现 31 项、冻结 v1 30 项）。
- 相同 61 项测试在 `--isolate --no-dynamic-test-linking --fuzz-seed 0x712` 下通过；每版包含普通和扩展价格各 256 轮 fuzz。
- `npm run test:integration` 通过：独立 Anvil 上模拟、部署及真实 RPC Permit/multicall 购买；买家仅发出一笔交易，支付 50 MMT，NFT 到账、nonce=1、allowance=0。
- 本次 Anvil 购买回执为 123,943 Gas，白名单为三个地址；它用于端到端验收，不与上表双叶白名单的 Foundry 读数混算。
- 原有构建 lint 提示仍存在（测试辅助代码的返回值/循环，以及带重入锁的事件顺序等）；新增窄类型转换都受价格范围分支约束，未降低检查级别或修改基线以隐藏提示。
- 提交钩子及客户端封装未变。本次不重复运行钩子，未执行 Git 发布或公共链部署。

## 对应源码 SHA-256

```text
707489e0abf6916e57b6d80e02e50f77d7669f5432b0ca4661e3d588bd1012bd  src/AirdopMerkleNFTMarket.sol
33f5e622c8135f56ce1c35224328ebd67e1b84b62fa9b36f1dc05511875a0e72  test/fixtures/AirdopMerkleNFTMarketV1.sol
84fc4ec34a311c8eabd67872b76f3bc12c20c9db52f4c03bc844eba29970ba5a  test/AirdopMerkleNFTMarket.t.sol
```

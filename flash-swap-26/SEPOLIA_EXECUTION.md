# Sepolia 闪电兑换成功记录

本记录对应真实 Sepolia 交易（chain ID `11155111`）。2026-10-12 已部署两种 MyToken、两套 Uniswap V2 Factory/Router、两个流动池及 FlashSwap 合约，并完成一次借 A、卖 A 换 B、用 B 还款的闪电兑换。

- 代码库：[flash-swap-26](https://github.com/woyaofei303/block-chain-list/tree/main/flash-swap-26)
- 成功交易：[查看 Sepolia 回执与事件](https://sepolia.etherscan.io/tx/0xec0ccff8a9b96104ebb104f028b3a3f44ff2ad85e31f5130854822970b294fbe)
- 区块：`11899294`；时间：`2026-10-12T21:49:00+08:00`（北京时间）。
- 发起者：`0xb103ea7790d7bf2a65aed1ce72c799576288fac3`，本机 keystore 名称为 `sepolia-deployer-2`。

## 交易实际做了什么

部署者调用 `FlashSwap.execute(100e18, 90e18, deadline)`。PoolA 向策略合约转出 100 A，并回调 `uniswapV2Call`。回调将 A 转入 PoolB，取得 B，再向 PoolA 偿还 B，把剩余 B 转给部署者。回调结束后 PoolA 的手续费与 K 检查通过，最终回执状态为 `0x1`。

下面五笔转账均来自这笔交易的真实 `Transfer` 事件，数量已经从 18 位最小单位换算：

```text
PoolA     → FlashSwap   100.000000000000000000 A
FlashSwap → PoolB       100.000000000000000000 A
PoolB     → FlashSwap   296.147410319118389655 B
FlashSwap → PoolA       202.628086279039137615 B
FlashSwap → 部署者      93.519324040079252040 B
```

策略发出的 `FlashSwapExecuted` 解码结果如下；数字保留代币最小单位，便于与原始事件核对：

```text
recipient = 0xb103ea7790d7bf2a65aed1ce72c799576288fac3
borrowedA = 100000000000000000000
receivedB = 296147410319118389655
repaidB   = 202628086279039137615
profitB   = 93519324040079252040
```

利润已扣两个池的兑换手续费，尚未折算 ETH gas；本练习代币没有设定真实市场价值。

## 真实回执与事件节选

以下字段直接取自 `cast receipt --json`，仅省略了无关字段和其余事件。这是链上成功证据，不是 Forge 广播前的模拟输出：

```json
{
  "transactionHash": "0xec0ccff8a9b96104ebb104f028b3a3f44ff2ad85e31f5130854822970b294fbe",
  "blockNumber": "0xb5919e",
  "status": "0x1",
  "from": "0xb103ea7790d7bf2a65aed1ce72c799576288fac3",
  "to": "0x7f98466ab137ad1230b2d0ca72494580d119ae96",
  "gasUsed": "0x98072",
  "effectiveGasPrice": "0xf4258",
  "logs": [
    {
      "address": "0x7f98466ab137ad1230b2d0ca72494580d119ae96",
      "topics": [
        "0x9ee60c53789b39526e71039cc44fcc74165957ba81bedbcfbcd52c96121aa37a",
        "0x000000000000000000000000b103ea7790d7bf2a65aed1ce72c799576288fac3"
      ],
      "data": "0x0000000000000000000000000000000000000000000000056bc75e2d631000000000000000000000000000000000000000000000000000100ddef4a106e7519700000000000000000000000000000000000000000000000afc0792e6b354b74f00000000000000000000000000000000000000000000000511d761ba53929a48",
      "blockHash": "0x7a4e26a26273bebc2697bc12e3aedcbe3a1d6396e000e759de2fe9edb9a1b439",
      "blockNumber": "0xb5919e",
      "blockTimestamp": "0x6acce54c",
      "transactionHash": "0xec0ccff8a9b96104ebb104f028b3a3f44ff2ad85e31f5130854822970b294fbe",
      "transactionIndex": "0x75",
      "logIndex": "0x107",
      "removed": false
    }
  ]
}
```

交易实际消耗 `622706` gas，费用为 `0.000000622720944944 Sepolia ETH`。本地 `cast run --quick` 回放也走到了 `uniswapV2Call`、还款和利润事件，但使用前一区块状态及本地 EVM，其 gas 数字不能替代真实回执。

## 本次部署地址

```text
deployer   = 0xb103ea7790d7bf2a65aed1ce72c799576288fac3
tokenA     = 0xcdc478f421f63f5ce7c2299d594013522acd2f4d
tokenB     = 0x09a0273029036fdde211fe03cdfa1174e068bfb8
weth       = 0x5cbdad6098860bc23aef39ec0a69c0e021ffe102
factoryA   = 0x771823a2e6a11f991902184d15726681b2feb414
routerA    = 0xd9fea7f67bd658535728c9e0401bbbbadbeb254b
factoryB   = 0xd50b79a652e9577be0ef8a6303dcf49322e062f8
routerB    = 0x21475370c0eb78a44a479805991430d855557d8c
flashSwap  = 0x7f98466ab137ad1230b2d0ca72494580d119ae96
poolA      = 0x84435a5e0f87831680db85588f7c42f86c0586dc
poolB      = 0x8ab00fd15ffa2d6c9fd77d5df85edd101cf10127
```

两种 MyToken 均为 18 位精度、各发行 100 万枚。两个 Factory 分别创建一个相同币对的池；两个 Router 各关联自己的 Factory，并共用本次部署的 WETH9。已检查所有地址都有代码、策略 owner 与部署者一致、LP 归部署者，以及四项加池授权均已用完。

本次 TokenB 地址小于 TokenA，Pair 的 `token0` 是 B。下面统一按 A/B 顺序列储备，避免把 `reserve0` 误当作 A。

## 交易前后核验

前置读取固定于区块 `11899281`，执行后读取固定于区块 `11899295`；Pair 储备与实际代币余额逐项一致。

```text
PoolA 之前：10000.000000000000000000 A + 20000.000000000000000000 B
PoolA 之后：9900.000000000000000000 A + 20202.628086279039137615 B
PoolB 之前：10000.000000000000000000 A + 30000.000000000000000000 B
PoolB 之后：10100.000000000000000000 A + 29703.852589680881610345 B

部署者 A：980000.000000000000000000 → 980000.000000000000000000
部署者 B：950000.000000000000000000 → 950093.519324040079252040
FlashSwap 合约执行后：0 A，0 B
```

成功部署及加池共 14 笔，闪电兑换 1 笔。首次创建 TokenA 因旧 gas 估算不足失败，未留下合约；核对失败回执、地址无代码与 nonce 后，才从新 nonce 重新生成部署。失败交易为 [`0x24c5…cdf94`](https://sepolia.etherscan.io/tx/0x24c5f765f7011b225d001edd7554d48eb4df15928b09bd2856ba3be74e6cdf94)。后续采用节点逐笔估算，细节见 [README](README.md#sepolia-部署与作业提交)。

费用由上述 16 个真实回执的 `gasUsed × effectiveGasPrice` 相加，包含失败支出：

```text
首次失败：0.000001101109436448 ETH
部署加池：0.000168276534126193 ETH
闪电兑换：0.000000622720944944 ETH
本次合计：0.000170000364507585 ETH
授权上限：0.001000000000000000 ETH
```

闪电兑换所在区块的钱包 ETH 余额为 `0.636883946327678276`。费用按回执统计，不把期间充值引起的余额变化当作 gas。

## 本地原始文件与复查

完整运行文件保存在仓库根目录的 `output-tdd/flash-swap-26/`，由 Git 忽略；本页是供作业提交的公开证据摘录：

```text
deploy-sepolia-rpc-final.log
execution-sepolia.log
receipt-11155111.json
transaction-11155111.json
replay-11155111.log
verified-sepolia-before.json
verified-sepolia-after.json
sepolia-fee-ledger.json
```

安装 Foundry 后，在任意目录可直接查询这笔交易；下面只有读取，不会重新执行或扣费：

```bash
cast receipt 0xec0ccff8a9b96104ebb104f028b3a3f44ff2ad85e31f5130854822970b294fbe \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com --json
```

代码已通过 15 项 Forge 测试（含 256 组随机输入）及独立 Anvil 部署验证；本页另有真实 Sepolia 回执、事件与执行前后状态核验。没有执行后续套利，未向课程平台代交；再次操作会面对已改变的储备与报价。

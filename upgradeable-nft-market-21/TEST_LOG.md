# 历史实测日志

## 怎样从测试结果判断升级没有丢数据

先读 [README](README.md) 的代理与实现例子，再按“升级前状态 → 升级调用 → 升级后查询 → 原订单成交”看日志。仅看到 version=2，不能证明 NFT 持有人、授权和挂单都还在。

签名测试还要反向检查：换链、换代理、改价格、过期或复用 nonce 都应失败，且余额与挂单不能留下半次变更。成功路径与回滚路径缺一不可。

下面是原版本的测试和模拟证据，公共测试网广播尚未完成。本次文档重构未重跑测试、升级或外部浏览器验证，原始日期、数量和输出不变。

日期：2026-09-30（Asia/Shanghai）。执行目录：`upgradeable-nft-market-21`。Solidity 0.8.24，优化 200 runs，EVM Cancun。以下为本次执行结果，不是预期输出。

## 工具与命令

```text
forge Version: 1.8.1
Commit SHA: 982849d3140c01fd3b72905759581a132df7aa98
Build Timestamp: 2026-08-28T17:50:40.383510000Z (1787939440)
Build Profile: dist
```

```bash
forge fmt --check
forge build
forge test -vv
```

格式检查、构建、测试退出码均为 `0`。构建存在下方已分析的 lint 告警，未宣称零告警。`forge test` 原始输出：

```text
No files changed, compilation skipped

Ran 24 tests for test/NFTMarket.t.sol:NFTMarketTest
[PASS] testAllOrderInvalidationPaths() (gas: 2903248)
[PASS] testCallbackPurchaseBeforeAndAfterUpgrade() (gas: 2786384)
[PASS] testCallbackRejectsForgeryWrongAmountAndData() (gas: 490938)
[PASS] testCancelAndInvalidBuyer() (gas: 324768)
[PASS] testDigestMatchesIndependentEIP712Encoding() (gas: 2247239)
[PASS] testERC1271SellerCanSign() (gas: 2893510)
[PASS] testExpiredSignatureRejected() (gas: 2311418)
[PASS] testFuzzV1ExactPayment(uint256) (runs: 256, μ: 513307, ~: 513256)
[PASS] testInitializationLocks() (gas: 5470327)
[PASS] testInvalidInitializationAndUpgradeRollback() (gas: 1890310)
[PASS] testListingValidationAndSingleApproval() (gas: 426625)
[PASS] testNFTUpgradePreservesState() (gas: 2020389)
[PASS] testOnlyOwnerCanUpgradeOrMint() (gas: 3888946)
[PASS] testReceiverCannotReenterAnotherListing() (gas: 844082)
[PASS] testRejectingReceiverRollsBackPayment() (gas: 792560)
[PASS] testSignatureCannotCrossProxyOrChain() (gas: 4854481)
[PASS] testSignatureReplayRejectedAfterNFTReturns() (gas: 2604004)
[PASS] testSignedFieldsCannotBeTampered() (gas: 2658437)
[PASS] testSignedListingsUseOneApprovalForTwoNFTs() (gas: 2777263)
[PASS] testSignedPaymentFailureRollsBackNonceAndListing() (gas: 2822963)
[PASS] testSignedSettlementValidatesAssetsAndPrice() (gas: 2760479)
[PASS] testStaleOwnershipAndRevokedApprovalRevert() (gas: 420715)
[PASS] testUpgradePreservesStateAndV1ListingRemainsBuyable() (gas: 2968505)
[PASS] testV1BuySettlesAndClearsListing() (gas: 352547)
Suite result: ok. 24 passed; 0 failed; 0 skipped; finished in 28.98ms (67.80ms CPU time)

Ran 1 test suite in 30.44ms (28.98ms CPU time): 24 tests passed, 0 failed, 0 skipped (24 total tests)
```

## 红绿验证

V1 首次可编译的行为测试：`testV1BuySettlesAndClearsListing` 因 `Settlement not implemented` 失败（退出码 1）；实现共用结算后通过（退出码 0）。

V2 行为测试：升级状态与 V1 成交已通过，`testSignedListingsUseOneApprovalForTwoNFTs` 因 `Signed settlement not implemented` 失败（退出码 1）；实现签名验证与结算后通过（退出码 0）。依赖接口缺失的首次编译错误不计入行为红测。

## 存储布局

分别读取 `forge inspect NFTMarketV1 storage-layout --json` 与 V2 结果，递归比较字段名称、槽位、偏移、实际类型（排除编译器 AST 编号），V1 前缀完全相同，V2 只追加 nonce：

```text
PASS: V1 storage prefix unchanged; V2 only appends nonces
paymentToken: slot=0, offset=0
nft: slot=1, offset=0
listings: slot=2, offset=0
nonces: slot=3, offset=0
```

ERC721 与市场的管理员、资产/授权/挂单保留另外由公开 API 升级测试验证；这里只比较线性存储，不把它称为通用自动升级审计。

## Anvil 实际部署与交易

本次新建独立 `127.0.0.1:18545`、chain ID `31337`，只使用 Anvil 虚拟账户；验证结束后已停止本次启动的节点。先执行部署脚本模拟和广播，再铸造两枚 NFT、集合授权一次、V1 上架第一枚、给买家 1000 MKT 并授权。随后执行升级脚本模拟及广播。

升级前后逐项比较市场管理员、绑定资产、挂单、NFT 所有权/URI、集合授权、买家余额与 ERC20 allowance，结果完全相同。之后买家购买原 V1 挂单，再通过 `eth_signTypedData_v4` 签名购买从未调用 `list` 的第二枚 NFT。

```text
PASS: state preserved; V1 listing and offline signature settled
transactions: 8 ; single collection approval; buyer final balance: 800 MKT
```

本次本地地址（不是公共测试网提交地址）：

```text
支付币：0x5fbdb2315678afecb367f032d93f642f64180aa3
ERC721 实现：0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
ERC721 代理：0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0
NFTMarket V1：0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9
NFTMarket 代理：0xdc64a140aa3e981100a9beca4e685f962f0cf6c9
NFTMarket V2：0x610178dA211FEF7D417bC0e6FeD39F05609AD788
```

市场 `version()` 为 2，ERC-1967 实现槽为 V2 地址，EIP-712 域名称 `UpgradeableNFTMarket`、版本 `2`、chain ID `31337`、verifyingContract 为原市场代理。两枚 NFT 最终都属于买家，第二枚 nonce 为 1，市场支付币余额为 0。README 中的 `cast rpc eth_signTypedData_v4` 命令另行实测返回 65 字节签名；12 段 Bash 命令通过 `bash -n` 检查。

## Sepolia 只读模拟

RPC：`https://ethereum-sepolia-rpc.publicnode.com`，链 ID 实测 `11155111`。以旧文档中的公开账户 `0x000071424bb08b910f0786e04D964A63D64bF1Ba` 执行部署脚本，不加载 keystore，不签名、不广播。

```text
Script ran successfully.
Estimated max fee per gas: 1.934394444 gwei
Estimated total gas used for script: 5251410
Estimated amount required: 0.01015829832716604 ETH
```

以上仅涵盖五笔部署的网络模拟，未包含公共网络升级，不是上链证明。浏览器源码验证尚未执行；这份日志在首次 Git 提交前生成，后续代码发布不改变链上验证状态。

## 告警分析与已知限制

- Forge build 无 Solidity 编译错误；存在 `custom-errors`、`named-struct-fields` 等风格建议。教学代码保留短 revert 字符串。
- 生产源码有 4 条静态安全提示：`block-timestamp` 用于订单到期且包含边界测试；`reentrancy-events` 位于受重入锁保护的结算末尾，支付/接收失败会回滚事件；`missing-events-access-control` 是内部清理挂单，调用方结算会发 `NFTSold`；`arbitrary-send-erc20` 的 buyer 在非预付款入口只能来自 `msg.sender`，回调入口只允许固定支付币且使用 `safeTransfer`。
- 测试辅助代码另有 10 条 `calls-loop`、15 条 `unused-return`、4 条 `erc20-unchecked-transfer`：循环是测试断言场景，直接 ERC20 调用使用本项目固定 MarketToken，并有资产结果断言；其中预期回滚调用不依赖返回值。这些提示没有通过全局关 lint 隐藏。
- Forge 脚本还输出部分源文件的 trace 解析告警和未配置 Etherscan 的提示；合约编译、模拟、广播、回执及独立链上状态核验均成功。未修改共享 forge-std 来消除工具侧提示；它们不等于源码已在浏览器验证。
- 测试不构成生产安全审计；不涵盖任意恶意/扣税支付币、管理员作恶、未来不兼容实现或公共网络真实成交。

完整运行产物位于仓库忽略目录 `output-tdd/upgradeable-nft-market-21/`，包括构建/测试/模拟日志、存储布局和 Anvil 快照对比；此文件保留供 GitHub 展示的实际测试输出。

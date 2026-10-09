# 17 · Meme 工厂：共享代码、分别发行代币

如果每创建一种币都部署整份 ERC20，成本较高。这个项目先部署一份完整实现，以后创建很小的代理合约来使用它。你会看到 DOG 和 CAT 共用代码，却分别保存自己的符号、余额和发行量。

先学 [07 的 ERC20](../tokenbank-07/README.md)。本项目有自己的固定依赖，可以独立编译，不依赖第 09 项目。

## 用 DOG 的三次铸造理解业务

发行者设置 DOG：上限 300 枚，每次买 100 枚，每枚 1 gwei。**精度为 0**，余额 100 就是 100 枚，不再乘 `10^18`。

```text
一次购买费用 = 100 × 1 gwei = 100 gwei
平台收到 = 1 gwei
发行者收到 = 99 gwei
买家收到 = 100 DOG
```

三次购买后发行 300 枚，第四次失败。Gas 是买家另付给网络的费用，不参与 1% 分账。若上限改为 250、批量仍为 100，最多铸 200，最后不足一批会拒绝。

创建时的 `totalSupply` 参数表示上限；ERC20 查询的 `totalSupply()` 表示**已经铸出**多少，刚创建时是 0。这两个同名概念不要混淆。

## 先运行测试，再动手部署

准备 Foundry，从仓库根目录执行：

```bash
cd meme-factory-17
forge fmt --check
forge build
forge test -vv
forge script script/DeployMemeFactory.s.sol:DeployMemeFactory
```

最后一条只在临时 EVM 模拟部署，不向任何节点写入。按 [操作指南](USAGE.md) 可继续启动本地 Anvil、创建 DOG、买三次并读取真实余额差。2026-10-09 已通过 18 项 Forge 测试；未重跑这里的独立部署与 Anvil 手工演示。

## 最小代理到底共享什么

把实现合约想成一份操作说明，DOG、CAT 各有自己的账本。ERC-1167 代理把调用转给固定实现；使用 `delegatecall` 时，执行的是共享代码，读写的是当前代理的存储。

所以 DOG 铸了 100，不会让 CAT 也多 100。这个代理的实现地址固定，**不是可升级代理**；可升级设计留到 [21](../upgradeable-nft-market-21/README.md)。

构造函数只在部署实现合约时运行，不会替每个代理填参数。因此工厂创建代理后，在同一交易调用 `initialize`。实现本身禁止初始化，每个代理只初始化一次，避免别人抢先配置。

## 谁调用谁，钱去哪里

```text
项目方部署 Factory → Factory 创建并锁定 implementation
发行者 deployMeme → clone → initialize → 记录 issuer
买家 mintMeme + 精确费用 → 代理 mint → 买家代币余额增加
                         → 平台收 1% → 发行者收余款
```

只有工厂能调用代币 `mint`，工厂也只认可自己登记的代理。买家少付、多付都会失败；任一收款方拒收，铸币与已发生的分账一起回滚。重入锁限制收款回调再次铸币。

平台金额按 `cost / 100` 向下取整，余数归发行者。例如 101 Wei 分成 1 与 100；不足 100 Wei 时平台得到 0。`price=0` 允许免费铸造，但供应上限仍生效。

## 对照代码检查理解

- [MemeFactory.sol](src/MemeFactory.sol)：按构造函数、`deployMeme`、`mintMeme`、`_pay` 阅读。
- [MemeToken.sol](src/MemeToken.sol)：看 `initialize` 与 `mint` 各自的权限。
- [MemeFactory.t.sol](test/MemeFactory.t.sol)：找支付错误、最后不足一批、收款失败的状态断言。

“公平”在这里仅指每次固定价格和固定数量，同一地址可以反复买；没有防机器人或每人限购。symbol 可以重复，识别币必须用合约地址。

完整依赖版本与恢复命令见 [项目自己的依赖](USAGE.md#项目自己的-foundry-依赖)，历史实测保存在同一操作指南。

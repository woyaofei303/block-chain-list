# 上游来源与本地差异

源码取得于 2026-10-09。只保存完成本题需要的合约，不引入 Hardhat、Waffle、Node 包管理器、Git 子模块或嵌套仓库。

## 固定来源

- [Uniswap v2-core v1.0.1](https://github.com/Uniswap/v2-core/tree/d2bfbb3649b265559bec74a7dd878dc1cf01c63c)：提交 `d2bfbb3649b265559bec74a7dd878dc1cf01c63c`。生产合约完整保存于 `src/core/`；上游 `contracts/test/ERC20.sol` 保存为 `src/demo/ERC20.sol`。
- [Uniswap v2-periphery](https://github.com/Uniswap/v2-periphery/tree/ed24991304291297c3b4a52818d02f46a17aa9a2)：提交 `ed24991304291297c3b4a52818d02f46a17aa9a2`，包版本 `1.1.0-beta.0`。保存 Router02、其接口和必需的 SafeMath / UniswapV2Library；上游 `contracts/test/WETH9.sol` 保存到 `src/demo/`。
- [@uniswap/lib 4.0.1-alpha](https://registry.npmjs.org/@uniswap/lib/-/lib-4.0.1-alpha.tgz)：与该 Periphery 的依赖声明一致。只保留实际使用的 `TransferHelper.sol` 及许可证，源码未改动。
- `forge-std` 直接复用仓库 `foundry-counter-09/lib/forge-std/src/`，未修改或重新下载。运行本工程需要完整仓库，单独复制本目录时须同步调整此映射。

本次下载的 `@uniswap/lib` 压缩包 SHA-256：

```text
ea593bcb9d46f237bfe3fc29e0b4984ba62d97fd5eb9d891f52450affe6d50b3
```

保留 [Core 许可证](src/core/LICENSE)、[Periphery 许可证](src/periphery/LICENSE)、[TransferHelper 许可证](lib/uniswap-lib/LICENSE) 与 WETH9 内嵌版权声明。新增测试和脚本采用 `GPL-3.0-or-later`。

## 有意保留与修改的部分

1. 为 Factory、Pair、LP ERC20、Router02、定价库、数学库和示例代币添加中文注释，并运行 `forge fmt`。格式化包含引号、`uint` → `uint256` 等等价语法调整。
2. `UniswapV2ERC20` 的汇编 `chainid` 改为 `chainid()`，兼容当前 Foundry 的 Solar 格式解析器；实际仍由 Solidity 0.5.16 编译为同一操作。
3. 移动示例 ERC20 后，将其导入改为 `../core/UniswapV2ERC20.sol`。
4. 将 `UniswapV2Library.pairFor` 中原版 `96e8…845f` 替换为本地 Pair 创建字节码的哈希，详见 [README](README.md)。没有把 `pairFor` 改成 Factory 查询，也没有移除 CREATE2。
5. 未修改 Core 的业务逻辑、0.3% 手续费、权限、锁、储备公式、Permit 或旧版整数溢出语义；未改写 Router02 的流动性和兑换逻辑。

本项目没有复制 Router01 实现、V1 Migrator、Oracle 示例或上游开发测试；Router01 **接口**由 Router02 继承，因此保留。源码覆盖本题实际部署的 V2 核心与 Router02 周边，不代表完整复刻上游开发仓库。

`src/demo/ERC20.sol` 是官方测试币，A、B 都沿用 `Uniswap V2` / `UNI-V2` 名称；识别时使用地址。`src/demo/WETH9.sol` 是该版本 Periphery 的测试副本，未启用直接转 ETH 的 fallback，须显式调用 `deposit()`；Router02 已按此方式调用。两者仅用于本地练习。

题目参考 [Learn-DeFi-Project 的 Swap 分支](https://github.com/lbc-team/Learn-DeFi-Project/tree/Swap)（本次读取提交 `5ce24c9b0a443a81d690e6573dcc18b2545288e8`）仅作工程组织参考；本题未要求实现完整前端，因此不复制其 DApp。

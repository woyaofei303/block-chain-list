# Uniswap V2 学习工程

继承 [仓库规则](../AGENTS.md)。本目录只完成原版 V2 合约阅读、Foundry 测试与本地部署。

- `src/core/` 保留上游 Solidity 0.5.16，`src/periphery/` 保留 0.6.6；主要合约添加中文学习注释，不迁移到 0.8 或改变手续费、权限与溢出语义。
- 本题明确要求注释上游源码，因此这些源码副本可添加注释；除 `UniswapV2Library.pairFor` 的本地创建字节码哈希外，不修改上游业务逻辑。来源、固定提交与差异写在 `UPSTREAM.md`。
- 测试、部署脚本使用 Solidity 0.8.24，通过产物字节码部署旧版合约，不能直接导入不兼容的实现。forge-std 复用 `../foundry-counter-09/lib/forge-std`，不新增 Node 包管理器。
- 编译设置固定为 Istanbul、optimizer 999999 次；更改 Pair、其依赖、注释、路径或编译配置后，重新计算创建字节码哈希，更新 Library，运行哈希一致性测试。
- `test/` 覆盖 CREATE2 地址、LP、兑换金额、滑点、期限、权限与回滚；`script/` 用 `forge script` 部署 Factory、WETH9、Router02 与示例池。
- 从本目录执行 `forge fmt --check`、`forge build`、`forge test -vv`。日志、缓存与广播写到 `../output-tdd/uniswap-v2-25/`。
- 本地部署脚本限制 chain ID 31337；仅使用隔离 Anvil 的公开解锁账户，不读取私钥。不得广播公共链交易。

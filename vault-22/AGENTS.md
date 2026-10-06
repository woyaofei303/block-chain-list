# Vault CTF 项目规则

本目录遵守 [仓库规则](../AGENTS.md)。这是一个 Solidity / Foundry 本地安全练习，项目源码故意保留 `delegatecall`、存储槽碰撞和提款重入漏洞，用于教学验证，不要把它部署到公共链。

- 代码阅读顺序：先读 `README.md`，再读 `src/Vault.sol`、`test/Vault.t.sol` 和 `script/Vault.s.sol`。
- 使用 Foundry 默认配置和 Solidity `^0.8.0`，测试复用 `../foundry-counter-09/lib/forge-std`，不重复 vendoring 依赖。
- `test/Vault.t.sol` 只在 Forge 本地 EVM 中验证攻击流程；不广播交易、不使用真实资金。
- 部署脚本必须使用 `forge script`。本地 Anvil 使用公开测试账户和 `--unlocked`，脚本不读取或硬编码私钥、助记词。
- 修改自有 Solidity、测试或脚本时，为每个函数、构造函数、回调和关键安全步骤补充中文 NatSpec / 学习注释。
- 在项目目录执行 `forge fmt --check`、`forge build` 和 `forge test -vvv`；`cache/`、`out/` 和 `broadcast/` 为本地产物，不纳入版本控制。

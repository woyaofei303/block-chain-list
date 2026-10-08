# CRE TokenBank 自动化项目规则

本目录是仓库第 23 个练习，继承 [../AGENTS.md](../AGENTS.md)；只补充本项目特有约束。

- Solidity 合约位于 `contracts/evm/src/`，CRE TypeScript 工作流位于 `my-workflow/`。
- `TokenBank` 业务合约沿用 `../tokenbank-07/contracts/TokenBank.sol` 的 Remix 版本；本项目只提供 CRE Receiver、Foundry 行为测试和部署脚本。
- 本地只做 Forge、Bun 测试和 CRE workflow simulate；不读取、提交或输出 `.env`、`secrets.yaml`、私钥和访问令牌。
- 公共链部署或广播必须先核对 Sepolia 网络、合约地址、Forwarder、接收地址、阈值和费用；默认使用不广播模拟。
- 新增的自有 Solidity/TypeScript 函数、测试和部署入口必须有中文用途与实际约束注释；生成的 ABI/SDK 文件不手工扩展业务逻辑。
- 临时日志放仓库根目录 `output-tdd/tokenbank-cre/`，不提交；主要验证命令：

```bash
forge fmt --check --root cre-project-23/contracts
forge test --root cre-project-23/contracts
bun test --cwd cre-project-23/my-workflow
bun run --cwd cre-project-23/my-workflow typecheck
```

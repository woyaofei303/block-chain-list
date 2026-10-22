# 31 · NFTMarket 的 The Graph 索引

遵守 [根规则](../AGENTS.md)。本项目只新增索引与部署演示，直接复用 `../tokenbankv2-08/src/NFTMarket.sol`、支付代币及 09 的 Foundry 依赖，不修改旧项目业务。

- Solidity 0.8.24 / Cancun；npm 管理 Graph CLI、graph-ts 与本地 TypeScript 验证工具。
- `src/mapping.ts` 为 AssemblyScript，由 `graph build` 检查；`scripts/*.ts` 是 Node.js TypeScript，启用 strict 并执行 `npm run typecheck`，不能把两种编译器混用。
- 事件是 `NFTListed` / `NFTSold`，实体名是 `List` / `Sold`。本合约没有取消、截止日期或手续费；对应字段必须表达真实语义，不能伪造事件。
- 每次上架使用交易哈希加日志序号作为 ID；成交关联当时最新的上架，支持改价、再次出售与同一交易多条日志。
- 检查：`npm run check`、`forge fmt --check`、`forge test`；`npm run test:integration` 验证独立 Anvil 的真实部署与两条购买路径；Docker Graph Node 另按 README 启动，结束清理本次资源。
- `script/Deploy.s.sol` 的 `run()` 只部署三个合约；`runWithDemo()` 额外铸造、授权、上架并自买。Sepolia 广播必须具备对应账户、交易和费用的具体授权。当前授权和广播状态见 README，不能把一次授权用于重复部署。
- `subgraph.yaml` 的占位地址不能当部署证据；生产配置通过脚本生成到被忽略的目录。截图必须注明本地或 Sepolia，禁止用本地结果冒充正式提交。

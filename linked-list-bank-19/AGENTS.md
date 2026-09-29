# 链表 Bank 练习规则

本目录遵守 [仓库规则](../AGENTS.md)。使用 Solidity 0.8.24、Foundry、Shanghai，无第三方库、Node 包或前端。

- 先读 `README.md`，再读 `src/Bank.sol`、`test/Bank.t.sol`、`script/DeployBank.s.sol`。
- 本题接收原生 ETH；`deposits` 是累计存款，管理员提款不减少历史记录。保留原 Bank 的管理员权限和提款重入保护。
- 排行榜必须用单链表存储，最多 10 个非零地址；`next(address(0))` 为第一名，尾节点指向零地址。金额降序，同额排在已有同额用户之后。淘汰只移除节点，保留累计存款。
- 所有自有函数和关键链表操作写中文 NatSpec / 学习注释。测试覆盖两个存款入口、排序、同额、淘汰再入榜、重复存款、权限及失败回滚。
- 在本目录执行 `forge fmt --check`、`forge build`、`forge test -vv`；部署只用 `forge script script/DeployBank.s.sol:DeployBank`，先模拟，再在独立 Anvil 上核验。
- 本地广播使用 Anvil 解锁测试账户，不读取私钥；默认 RPC 端口 `18549`，启动前确认未占用。公共链操作须另有具体授权。
- Foundry 的 `out/`、`cache/`、`broadcast/` 保持忽略；其他临时日志放仓库 `output-tdd/linked-list-bank-19/`。本项目没有环境文件和依赖安装步骤。

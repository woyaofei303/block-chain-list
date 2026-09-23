# block-chain-list

区块链学习与全栈实践仓库，记录从 PoW、数字签名、Solidity 合约到事件索引和钱包页面的练习。每个项目保留自己的源码、说明、运行方式和验证入口，方便按顺序复习。

**复习按目录尾部编号 `01 → 16` 进行。** GitHub 按目录名称排列，不代表学习顺序；可以直接使用下面的索引。

## 项目与复习顺序

| 编号 | 项目入口 | 主要内容 |
| --- | --- | --- |
| 01 | [multi-chat-py-01](multi-chat-py-01/README.md) | Python 终端聊天、Next.js Web 聊天、流式响应、停止生成与请求去重 |
| 02 | [node-blockchain-homework-02](node-blockchain-homework-02/README.md) | Node.js 教学链：PoW、交易入块、HTTP 节点与 WebSocket 同步 |
| 03 | [pow-rsa-ecc-homework-03](pow-rsa-ecc-homework-03/README.md) | SHA-256 工作量证明、RSA / ECC 签名与验签 |
| 04 | [firstcontract-04](firstcontract-04/README.md) | Counter 入门、Foundry 验证、Remix 与 Sepolia 操作 |
| 05 | [bank-05](bank-05/README.md) | ETH 银行、累计存款排名与管理员提款 |
| 06 | [bigbank-06](bigbank-06/README.md) | 接口、继承、存款门槛与 Admin 合约 |
| 07 | [tokenbank-07](tokenbank-07/README.md) | ERC20、授权、TokenBank 存取款与 Remix 测试 |
| 08 | [tokenbankv2-08](tokenbankv2-08/README.md) | NFTMarket、普通购买、回调购买与 Viem 事件监听 |
| 09 | [foundry-counter-09](foundry-counter-09/README.md) | Foundry Counter、OpenZeppelin ERC20 与合约测试 |
| 10 | [bank-tokenbank-tests-10](bank-tokenbank-tests-10/README.md) | Bank 单元测试、Sepolia USDT fork 测试 |
| 11 | [erc721-nft-11](erc721-nft-11/README.md) | ERC721 NFT、图片、IPFS 元数据与部署记录 |
| 12 | [erc20-event-indexer-12](erc20-event-indexer-12/README.md) | Express、Viem、PostgreSQL 转账索引与重组恢复 |
| 13 | [tokenbank-fullstack-13](tokenbank-fullstack-13/README.md) | 独立 TokenBank 全栈：合约、数据库、API、钱包、请求管理与幂等操作 |
| 14 | [cli-wallet-14](cli-wallet-14/README.md) | 命令行钱包：加密私钥、余额、ERC20 EIP-1559 构建、签名与 Sepolia 广播 |
| 15 | [multisig-wallet-15](multisig-wallet-15/README.md) | 多签合约钱包：固定持有人与门槛、链上提案确认、任何人执行与失败重试 |
| 16 | [eip712-permit-16](eip712-permit-16/README.md) | 汇总已有银行、市场与 NFT 实现的独立全栈练习：Permit 存款、白名单购买及[完整命令行流程](eip712-permit-16/WALKTHROUGH.md) |

`tokenbankv2-08` 沿用历史目录名，目前用于 NFTMarket；TokenBank 的前后端已经独立到 `tokenbank-fullstack-13`。

## 如何开始

在准备存放仓库的目录执行：

```bash
git clone https://github.com/woyaofei303/block-chain-list.git
cd block-chain-list
```

之后按以下顺序进入一个练习：

1. 先读 [仓库规则](AGENTS.md)，再读目标项目适用的 `AGENTS.md` 和 `README.md`。
2. 按项目说明准备环境、安装依赖，只启动本次需要的服务。
3. 从文档标注的入口读代码，运行对应测试，再按指南完成操作。
4. 对照实际结果复习失败、取消、重试和恢复流程；历史截图与部署记录不代表本次已经验证。

仓库根目录没有统一的应用启动命令。各项目使用自己的包管理器和配置：

- **Node.js / 前端**：Node 作业及索引器使用 npm，Next.js 前端使用 pnpm。TokenBank 全栈要求 Node.js 24+；其他项目以各自 `package.json` 为准。
- **Python**：聊天终端使用虚拟环境和项目自己的依赖说明。
- **合约**：Foundry 项目使用 Forge / Cast / Anvil；Remix 练习按其网页操作指南执行，Remix 测试不直接当作 Forge 测试运行。
- **数据库**：转账索引器与 TokenBank 全栈需要 PostgreSQL；环境配置从对应 `.env.example` 开始，不提交本地凭据。

例如，从**仓库根目录**运行 Node 教学链测试：

```bash
npm --prefix node-blockchain-homework-02 ci
npm --prefix node-blockchain-homework-02 test
```

已安装 Foundry 时，从**仓库根目录**验证 Counter：

```bash
forge test --root firstcontract-04
```

`foundry-counter-09/lib` 的依赖源码已经随仓库保存，克隆后不必重新初始化子模块。部分兄弟项目通过相对路径复用它们，请保留仓库目录结构。

## TokenBank 全栈入口

想复习从合约到页面的完整调用链，可以直接进入第 13 个项目：

- [项目说明与代码阅读顺序](tokenbank-fullstack-13/README.md)
- [本地运行、旧环境恢复与逐步验收](tokenbank-fullstack-13/WALKTHROUGH.md)
- [React 请求管理、错误队列、SIWE 登录与端到端幂等](tokenbank-fullstack-13/REQUESTS.md)
- [前端账户、余额与钱包交互](tokenbank-fullstack-13/frontend/README.md)
- [后端索引和 API](tokenbank-fullstack-13/backend/README.md)
- [数据库与数据核对](tokenbank-fullstack-13/database/README.md)

该项目使用 TypeScript、React、TanStack Query v5、Viem、Express、PostgreSQL 和 Solidity。应用内 HTTP 最大并发为 **6**；错误提示最多保留 **3** 条，包含当前显示的一条，同屏只显示一条。存取款使用同一个操作编号贯穿页面、服务端与幂等银行合约，支持终止等待和刷新恢复。

新页面向 `IdempotentTokenBank` 提交交易，旧版 `TokenBank` 保留只读入口与原部署。终止请求不会撤销已经广播的交易；钱包余额、个人存款与银行总资产也不是同一个数值。具体配置和恢复边界以项目文档为准。

## 新建项目与维护规则

- 独立项目放在根目录，命名为 `<project-name>-<NN>`；检查实际目录与索引后取最大编号加一，不回收旧编号。
- 创建项目时先建立并读取项目自己的 `AGENTS.md`，再实现业务；同步更新本页索引与根目录 [AGENTS.md](AGENTS.md)。
- 新增 Node.js、前端业务代码和测试统一使用 TypeScript，启用严格类型检查。已有 JavaScript 练习按实际修改范围迁移。
- 前后端按领域和职责划分模块，复用已有能力，不为形式增加抽象层；前端样式使用 Tailwind CSS。
- 新建前端接入现有 Husky、lint-staged、Biome 提交检查，使用各项目实际存在的类型检查和测试脚本。

完整规则以 [AGENTS.md](AGENTS.md) 及目标目录的子级规则为准。

## 验证与运行边界

每个项目的 README 列出自己的验证命令。当前 [Foundry CI](.github/workflows/foundry-counter.yml) 只覆盖 `foundry-counter-09`，不能把它通过视为所有项目通过；数据库集成测试需要 PostgreSQL，fork 测试还需要可用 RPC。

练习优先在本地模拟环境验证。公共链操作需要核对网络、账户、目标与金额；私钥、助记词和服务凭据不进入代码或文档。项目说明中的历史部署记录仅用于复习，不构成再次部署或转账的授权。

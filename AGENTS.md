# block-chain-list 使用与新建项目规则

本文件适用于整个仓库。每次新建项目、继续练习或修改代码前，必须先读取本文件，再读取目标目录适用的 `AGENTS.md` 和项目文档。不要只依赖上次会话的记忆。

本规则最初根据 12 个项目的 19 份自有 Markdown 文档、包脚本、Foundry 配置和共享提交钩子整理，并随新项目维护；第三方依赖与临时产物不作为本仓库规则来源。用户本次明确要求优先；更深层的 `AGENTS.md` 补充其目录内的具体要求，兄弟项目的规则不自动适用于当前目录。

## 1. 开始前必须读取

1. 确认 Git 仓库根目录并检查 `git status --short`，识别已有修改、未跟踪文件及正在进行的目录迁移，不覆盖其他工作。
2. 读取仓库根目录的 `AGENTS.md`，再按从外到内的顺序读取目标路径上已有的 `AGENTS.md`。从子目录启动任务时，也必须主动读取根目录文件。
3. 修改已有项目：读取它的 `README.md`，以及本次工作涉及的 `USAGE.md`、`REMIX_GUIDE.md`、`WALKTHROUGH.md`、架构说明和测试。先理解实际调用链，再改代码。
4. 新建项目：先按第 2 节确定编号，再从第 3 节选择同类项目，读取其文档和配置作为参考；不得直接套用不相关的框架或业务规则。
5. 核对目标项目的 `package.json`、锁文件、`foundry.toml`、`remappings.txt`、`.gitignore` 和现有检查脚本。运行环境以实际配置为准；文档与代码冲突时先核实，不凭目录名或历史截图猜测。
6. 开始实现前简短说明已读规则、目标目录和本次检查方式。普通可逆实现不需要再次请求许可；只对影响范围或行为的缺失信息提问。

现有子级规则包括 [聊天 Web 规则](multi-chat-py-01/web/AGENTS.md)、[Token Bank 全栈规则](tokenbank-fullstack-13/AGENTS.md) 及其 [前端规则](tokenbank-fullstack-13/frontend/AGENTS.md)、[EIP-712 全栈规则](eip712-permit-16/AGENTS.md) 及其 [前端规则](eip712-permit-16/frontend/AGENTS.md)。修改 Next.js 项目前须读取安装版本的本地文档，并保留框架维护的规则块。各前端的 `CLAUDE.md` 仅转引同目录规则。

## 2. 新项目命名与编号（必须遵守）

- 每个新增的独立学习项目放在仓库根目录，名称使用小写英文、数字和连字符，并在**尾部**附加序号：`<project-name>-<NN>`，例如 `staking-14`。
- 编号在整个仓库内唯一，按新建顺序递增。创建前同时检查实际一级项目目录与下方项目索引，取已有最大编号再加 1；不能用目录数量加 1，也不能每个主题重新从 `01` 开始。
- 序号至少两位：`01` 至 `99`，之后继续 `100`。当前最大编号是 `16`，下一个应为 `17`；这是当前状态，未来必须重新计算，不能一直使用 `17`。
- 已有项目保持编号。删除或归档项目时保留占号记录，不回收编号、不填补空号、不重新按文件时间排序。修改内容或新增前端不会使旧项目变成新项目。
- `frontend/`、`backend/`、`src/`、`contracts/`、`test/` 等项目内部目录不单独编号；`.git/`、`.github/`、`.idea/`、`.superpowers/`、`docs-tdd/`、`output-tdd/` 等配置或辅助目录也不编号。
- 真正创建目录前再次检查编号和目标路径是否被占用；发现重复就重新计算，不覆盖或合并已有目录。默认不新建嵌套 Git 仓库。
- 每次新建项目都要在本文件第 3 节追加索引，并同步根目录 [README.md](README.md) 的复习索引，写明序号、目录、主题和文档入口。复习按尾部编号的数值顺序进行；按名称字典序排列不能代替编号顺序。
- 用户要求重命名或移动项目时，同步检查文档链接、代码与测试路径、包脚本、Foundry 依赖映射、CI、共享钩子和相关本机配置。历史 Git 提交内的路径及未移动的 `output-tdd/` 产物路径不机械替换。

## 3. 当前项目与复习入口

以下索引按编号排列，列出各项目的实际用途与使用边界。

1. `multi-chat-py-01`：Python 终端聊天和 Next.js Web 聊天。先读 [README](multi-chat-py-01/README.md)，再读 [ARCHITECTURE](multi-chat-py-01/docs/ARCHITECTURE.md)；Web 还须读上方子级规则。Python 使用虚拟环境，Web 使用 pnpm。服务端保存密钥；保持消息持久化、请求幂等、SSE 重放去重和停止生成的现有约束。
2. `node-blockchain-homework-02`：Node.js PoW、HTTP 节点与 WebSocket 同步。读 [README](node-blockchain-homework-02/README.md)。使用 npm、Node 原生测试和双节点 demo；教学链没有钱包、余额或真实资金。启动/停止须按顺序等待，测试结束释放节点和端口。
3. `pow-rsa-ecc-homework-03`：PoW、RSA、ECC 签名验签。读 [README](pow-rsa-ecc-homework-03/README.md)。在 `nodejs/` 执行 npm 脚本，仅使用 Node 标准库；密钥只在内存中使用，验证原文成功和篡改失败。
4. `firstcontract-04`：Counter 入门，Foundry 本地验证和 Remix/Sepolia 操作。读 [README](firstcontract-04/README.md) 与 [USAGE](firstcontract-04/USAGE.md)。Solidity `0.8.24`、Shanghai、关闭优化、无第三方合约依赖；产物位置以现有 `foundry.toml` 为准。
5. `bank-05`：Remix ETH 银行、累计存款前三名和管理员提款。读 [README](bank-05/README.md)。使用 `contracts/`、`tests/` 和 Remix Solidity Unit Testing；历史累计存款与银行当前资产不是同一数据，提款不清空历史排名。
6. `bigbank-06`：继承、接口、存款门槛与 Admin 合约。读 [README](bigbank-06/README.md)。每笔存款严格大于 `0.001 ether`，两个存款入口使用同一检查；提款终点是 Admin 合约，不是 owner 钱包。保持本练习的模拟范围。
7. `tokenbank-07`：BaseERC20 与标准 TokenBank。读 [README](tokenbank-07/README.md) 与 [REMIX_GUIDE](tokenbank-07/REMIX_GUIDE.md)。按题面保留接口与指定报错；使用 `approve → deposit → withdraw`，直接转币到银行不会计入个人存款。
8. `tokenbankv2-08`：保留 NFTMarket Foundry 合约、部署脚本和 npm/Viem 事件监听。读 [README](tokenbankv2-08/README.md)。普通购买与回调购买二选一；Token Bank 全栈流程已经独立到 `tokenbank-fullstack-13`。
9. `foundry-counter-09`：Foundry Counter 与 OpenZeppelin ERC20。读 [README](foundry-counter-09/README.md)。`lib/forge-std`、`lib/openzeppelin-contracts` 是随仓库保存的依赖源码，不是待初始化的子模块；部分兄弟项目复用这些依赖。
10. `bank-tokenbank-tests-10`：ETH Bank 单元测试和 Sepolia USDT fork 测试。读 [README](bank-tokenbank-tests-10/README.md)。不依赖 forge-std；fork 固定区块，使用 6 位精度的 Sepolia 测试 USDT，只修改本地副本。完整测试依赖可用 RPC；离线 Bank 测试不能代表 fork 测试通过。
11. `erc721-nft-11`：Blocklight Genesis ERC721、图片和 IPFS 元数据。读 [README](erc721-nft-11/README.md)。按“图片上传 → 更新 metadata → 验证 → metadata 上传”的顺序处理；已有 Base 主网记录不代表获准再次部署或铸造。
12. `erc20-event-indexer-12`：Express、Viem、PostgreSQL 转账索引。读 [README](erc20-event-indexer-12/README.md)。使用 npm；数据与扫描进度同事务提交，日志幂等入库，维护检查点和重组恢复。链上整数与 API 金额不能转成不精确的 Number；数据库集成测试使用独立临时 schema。
13. `tokenbank-fullstack-13`：独立 Token Bank 全栈闭环。先读 [项目规则](tokenbank-fullstack-13/AGENTS.md)、[README](tokenbank-fullstack-13/README.md) 和 [WALKTHROUGH](tokenbank-fullstack-13/WALKTHROUGH.md)。`contracts/` 管理银行与代币合约，`database/` 管理 PostgreSQL 表结构，`backend/` 使用 TypeScript 管理转账索引与查询，`frontend/` 按银行、钱包、转账领域组织；运行时不依赖其他练习源码。
14. `cli-wallet-14`：TypeScript / Ethers 命令行钱包。读 [项目规则](cli-wallet-14/AGENTS.md) 与 [README](cli-wallet-14/README.md)。生成加密 keystore、查询余额、构建和签名 ERC20 EIP-1559 交易，显式确认后广播到 Sepolia；默认仅模拟，不输出私钥。
15. `multisig-wallet-15`：Solidity / Foundry 简单多签钱包。读 [项目规则](multisig-wallet-15/AGENTS.md) 与 [README](multisig-wallet-15/README.md)。部署时固定持有人和门槛，通过交易提交与确认提案，达到门槛后任何人可执行；测试仅使用本地 EVM。
16. `eip712-permit-16`：EIP-2612 Token、签名存款与 EIP-712 白名单 NFT 全栈练习。读 [项目规则](eip712-permit-16/AGENTS.md)、[README](eip712-permit-16/README.md) 与 [操作指南](eip712-permit-16/WALKTHROUGH.md)。从 13 复用银行与前后端、从 08/11 复用市场与 NFT，现已统一到本目录 `contracts/`、`frontend/`、`backend/`、`database/`；业务源码不跨项目导入，仅共享 09 的第三方库及仓库钩子。默认仅在本地 EVM / Anvil 验证。

## 4. 新建项目的最小交付

创建带编号的目录后，先写并读取该项目自己的 `AGENTS.md`，再开始业务实现。每个新项目至少包含：

- `AGENTS.md`：链接 `../AGENTS.md`，明确适用范围、实际技术栈与包管理器、源码/测试入口、验证命令、特殊环境和风险边界。只写项目特有约束，不复制整份根规则；后续进入更深目录也要读取其已有规则。
- `README.md`：写明练习目标、题目或资料来源、已实现范围、代码阅读顺序、安装与运行步骤、配置项、验证方式和已知限制。区分题面要求与实现选择。
- 完成当前任务需要的源码及最小有效检查。非平凡逻辑、输入边界、金额和权限路径须有可运行验证；不添加占位测试、无用框架或“以后可能用到”的模块。
- 确有环境配置时提供不含秘密的 `.env.example`；使用现有包管理器的锁文件，检查其没有被全局忽略规则漏掉。没有依赖的练习不为了形式增加包管理器或锁文件。

README 中的命令必须注明从仓库根目录还是项目目录执行，使用完整可复制的代码块。普通项目在 README 内说明完整流程即可；只有操作流程确实很长时再拆出指南并相互链接。不要批量创建空目录或为已有项目补没有具体内容的规则副本。

## 5. 技术栈、依赖与质量检查

### 通用要求

- 先复用仓库已有实现、标准库和原生平台能力，再考虑现有依赖；确有必要时才添加新依赖。独立教学题可保留自己的实现，不为合并相似代码改变练习含义。
- 包管理器按项目选择，不把整个仓库强制改成同一种。Next.js 前端使用 pnpm，Node 作业、NFT 监听器和索引器使用 npm；`tokenbank-fullstack-13` 和 `eip712-permit-16` 的 backend 与 frontend 各自是独立包边界。
- Node、Next.js、Solidity 等版本以目标项目的约束和已安装版本为准。不要把一个项目的 EVM、优化器、引号风格或运行版本批量套到其他项目。
- 测试验证实际行为、边界与失败后状态；优先复用现有 Node 原生测试、Python unittest、Forge 或 Remix 测试。只改文档、路径或低影响配置时，执行相关静态和路径检查即可。

### Node.js 与前端统一使用 TypeScript

- 今后所有新建 Node.js 项目和前端项目，以及新增的业务模块、脚本和测试，统一使用 TypeScript：普通代码用 `.ts`，含 JSX 的组件用 `.tsx`；需要明确 ESM 文件格式时可用 `.mts`。不再新增 `.js`、`.jsx` 或 `.mjs` 业务实现。
- 修改已有 JavaScript 业务模块时，将本次涉及的模块及对应测试迁移为 TypeScript，同步调用路径、运行脚本和文档；不借机批量迁移无关历史练习。只改文档或配置不触发业务迁移。框架或工具要求的配置文件、第三方依赖与生成产物保留其要求的格式。
- 每个 Node.js 或前端包建立适用的 `tsconfig.json`，启用 `strict`，提供真实的 `typecheck` 脚本，并纳入现有提交检查和交付验证。类型检查覆盖源码与测试；Node 原生执行 TypeScript 不等于执行类型检查。
- 配置、领域数据、函数边界、数据库查询结果和 API 请求/响应应有明确类型。优先复用库自带类型和 TypeScript 类型推导，不用 `any`、`@ts-ignore` 或批量断言绕过检查；必要断言只放在已验证的边界。
- 环境变量、HTTP 参数及其他不可信输入仍须运行时校验；普通校验足够时不额外引入 Zod，结构复杂或需复用 schema 时再使用。金额保持 `bigint` 或精确字符串，不能为满足类型转换成不安全的 `number`。
- 前后端按实际领域和职责划分模块，共享类型放在所属领域内；没有独立职责或实际复用时不增加 service、接口、通用仓储或其他抽象层。

### 前端与 Web 项目

- 所有新增前端样式使用 Tailwind CSS；复用当前版本和主题。组件布局、间距、字体、颜色、响应式和交互状态使用工具类；全局样式保留主题、基础样式及必要共享样式。
- 当前前端基于 Next.js App Router、React、TypeScript、TanStack Query；钱包与链交互复用 Wagmi/Viem。遵守服务端与客户端边界，不将密钥或数据库访问放入浏览器模块。
- 每个新建前端或 Web 项目必须接入 Husky + lint-staged + Biome，JavaScript/TypeScript 分号使用 `asNeeded`。不默认安装 ESLint 或 Prettier；只有明确要求或必要文件类型不受 Biome 支持时才添加。
- 复用 [共享 pre-commit](multi-chat-py-01/web/.husky/pre-commit)，为新项目增加必要的范围检查，保留现有项目检查。当前 `core.hooksPath` 为 `multi-chat-py-01/web/.husky/_`；不得被新项目初始化命令覆盖成另一套互不相干的钩子。
- 配置可执行钩子和 install/prepare 接入。提交检查先 lint/format 暂存文件，再运行实际存在的 typecheck 和 test；缺少的脚本直接略过，不伪造占位项。交付前验证格式、lint、类型检查、测试和钩子；构建或浏览器验证按改动范围执行。
- 不在同一前端目录并发运行开发服务、生产构建和生产服务，避免共用 `.next` 产物冲突。修改环境变量后重启；生产环境的 `NEXT_PUBLIC_` 值改变时重新构建。

### Solidity / Foundry / Remix

- Remix 练习默认保持轻量：`contracts/`、需要的 `tests/`、说明和证据即可；`remix_tests.sol` 由 Remix 测试插件提供，不因此安装 Foundry、Hardhat 或前端。
- Foundry 项目遵循自身的 `src`、`test`、`script`、libs 和 remappings 配置，通常执行 `forge fmt --check`、`forge build`、相关 `forge test`。Remix 测试不能直接当作 Forge 测试运行。
- `tokenbankv2-08`、`erc721-nft-11` 通过相对路径复用 `foundry-counter-09/lib`。保持映射有效；不要重复下载或随意升级 vendored 库。`firstcontract-04`、`bank-tokenbank-tests-10` 的无第三方测试库方式继续保留。
- 编译器、EVM 与优化器设置要匹配具体项目及部署记录。当前练习并非全部使用同一设置；源码或注释改变后，旧部署不能自动视为与新字节码一致。
- 修改存款、提款或回调逻辑时检查所有入口和调用者，保留金额、身份、授权、回滚和必要的重入保护。区分钱包资产、个人可提余额、银行总资产及历史累计值；ERC20 精度读取自目标代币，不假定总是 18。
- 现有 [Foundry CI](.github/workflows/foundry-counter.yml) 只覆盖 `foundry-counter-09`，不能把其通过视为全部项目验证通过。

## 6. 本地运行与跨项目联调

- 启动前检查已有进程、端口和配置；能恢复原环境时就复用，不杀不明进程、不重复部署或充值。修改端口需同步钱包、前端、后端与 RPC 配置。
- TokenBank 联调须核对同一 RPC 实例、chain ID、银行 `token()`、索引器 Token 和 decimals；相同 chain ID 不代表同一条 Anvil 实例，NFTMarket 地址也不能作为 TokenBank 地址。
- 优先按 `tokenbank-fullstack-13/WALKTHROUGH.md` 选择“恢复已有环境”或“独立新建环境”。需持续复习时保留链状态、启动配置和数据库；链状态丢失后，合约地址或数据库不能恢复余额。
- 不覆盖已有 `.env`、`.env.local` 或本轮配置。独立复现使用独立端口与数据库/schema；恢复服务继续使用原数据库，不能重复创建、清空真实记录或混入其他链状态。
- 索引服务只提供历史查询，个人可提余额以链上合约为准。交易回执成功、索引追平和页面刷新是不同阶段；后端失败不能显示伪造的余额或交易成功。
- HTTP 路由校验输入，数据库层使用参数化查询，错误响应不泄露凭据或内部堆栈。前端使用现有同源代理，不无条件开放 CORS。
- 集成测试使用隔离状态，并在结束后释放自行启动的节点、HTTP 服务和测试 schema；不清理用户仍在使用的环境。

## 7. 钱包、链上动作与秘密

- 默认先本地模拟、测试或只读查询。公共链部署、铸造、授权、买卖、转账及钱包签名，必须已获得用户对具体网络、账户、目标、金额/额度和费用范围的授权；文档中的命令和历史授权不构成本次授权。
- 广播前核对 chain ID、合约代码、目标账户和模拟结果。超时或中断先查回执与广播记录，再决定是否恢复；不盲目重发、重新部署或重复充值。
- 不读取或输出私钥、助记词、完整访问令牌、会话 Cookie 或密码。钱包密钥使用用户自己的钱包或加密 keystore；不写入 `.env`、代码、命令历史、README、截图或聊天。
- API/数据库秘密仅保存于忽略的本地配置或既有秘密管理方式。`.env.example` 只放占位值和公开参数；`NEXT_PUBLIC_` 内容会进入浏览器，不能包含秘密。
- Anvil、Remix VM 和 fork 的交易、地址、余额只代表其模拟环境，不作为 Sepolia/Base 公共链证据。网站发布、IPFS 上传、课程答案提交等外部写入须在用户授权范围内。

## 8. 文档、产物与 Git 范围

- 学习文档采用中文说明，代码、命令、SQL、配置与路径保持可复制；SQL 写完整可执行语句。说明真实阅读顺序与调用流程，不只罗列文件。
- 严格区分“预期结果”“本次实测”和“历史记录”。本次未运行的检查、未广播的交易、未提交的答案不能标成完成；记录验证日期、环境与实际范围。
- 项目说明需要长期展示的图片放在项目内的 `screenshots/` 或 `assets/`，使用相对链接；交易证据只能保留公开且必要的信息。
- 临时日志、RPC 输出、模拟回执与验证产物放在 `output-tdd/<task-label>/`；Playwright 产物放在 `output-tdd/playwright/<task-label>/`。沿用已有项目配置的忽略产物目录，不为本规则批量搬迁已有输出。
- 确需保存的本地规划或任务说明放在 `docs-tdd/<category>/`。`docs-tdd/`、`output-tdd/` 默认不纳入提交；缺少忽略规则时优先使用 `.git/info/exclude`。
- 不改写历史部署证据或删除无关修改。覆盖 Git 外的现有用户文件前备份；仅暂存、回退本次范围。除非用户明确要求，不提交、推送、合并、rebase 或强推。
- 完成时列出 `修改文件`、实际验证结果和范围检查命令。新文件未暂存时普通 `git diff` 不显示其内容，须同时检查 `git status` 并读取新文件。

## 9. 每次新建项目的完成检查

- [ ] 已读取根规则、目标路径适用的子级规则，以及相关项目文档；未覆盖原有修改。
- [ ] 一级目录使用正确的最大序号加 1，编号唯一；本文件项目索引已同步更新。
- [ ] 新项目 `AGENTS.md` 已先于业务实现建立并读取，包含实际约束和命令，`README.md` 可按顺序复现。
- [ ] 工具链、包管理器、锁文件及依赖映射符合项目实际；Node.js/前端代码使用 TypeScript 并通过严格类型检查，新前端/Web 已接入并验证共享质量门禁。
- [ ] 已执行与本次实现相符的检查，记录未执行项的原因；文档链接与路径有效，秘密及本地产物未泄露。
- [ ] 已检查 Git 改动范围；未执行未经授权的链上、外部写入或 Git 发布操作。

这些规则是交付要求，不是每次都要用户确认的流程。能够在既有授权内完成的检查与实现应连续完成。

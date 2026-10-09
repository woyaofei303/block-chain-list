# block-chain-list · 从第一条链上记录学到兑换池

这个仓库有 25 个独立练习。目标不是背术语，而是每次跑通一件小事：改一个数字、存取一笔代币、查一条历史，最后理解签名、代理与兑换池。每个项目的 README 是学习入口，长命令和进阶细节按需跳转。

## 完全没接触过，从哪里开始

先做 **04 Counter**，看到“读取 0 → 发交易加 5 → 再读 5”；接着学 **05、06、07** 的金额、权限和授权。想知道区块为何连接、签名为何能验真，再补 **02、03**。

接下来用 **09、10** 学会测试，做 **11、08** 的 NFT，再走 **12、13** 的“链上 → 数据库 → 页面”。这些熟悉后，再按编号学习 **14～25**。**01** 是独立聊天应用，可作为请求、缓存和异步处理的补充课。

目录编号记录项目顺序，不表示难度严格递增。第一次不必全部安装，也不用先准备真实资产。

## 先认识一次操作中的六样东西

假设 Alice 要存入 10 枚代币：

- **钱包**控制账户的签名，地址像公开账号；资产余额记在链上，不在钱包图标里。
- **网络与 RPC**：网络是一份链状态，RPC 是访问节点的入口。地址相同、网络不同，余额也可能不同。
- **合约**是在链上执行的程序，保存状态并规定谁能怎样修改。
- **交易**是请求修改链上状态；**查询**只读或模拟，不保存修改。交易哈希是编号，回执成功才说明执行成功。
- **Gas**衡量计算成本，手续费另用原生币支付。有 Token 不代表有足够 ETH 付 Gas。
- **授权**允许银行使用一定数量的 Token，尚未转钱；**存款**才转币并登记可提余额。

ETH 最小单位叫 Wei，`1 ETH = 10^18 Wei`。ERC20 的精度由各自合约决定：18 位代币的 10 枚是 `10000000000000000000`，6 位代币则是 `10000000`。金额不能一律乘 `10^18`。

## 所有项目的学习入口

每一项都先讲例子，再给运行入口和代码路线。完成后，试着不看答案解释“谁发起、谁调用谁、状态怎么变”。

1. [01 多轮聊天](multi-chat-py-01/README.md)：同一句“我叫小明”怎样成为下一轮上下文；理解流式显示、停止与重试。
2. [02 两节点区块链](node-blockchain-homework-02/README.md)：提交记录、PoW 打包、同步给另一个节点；没有真实余额系统。
3. [03 哈希与数字签名](pow-rsa-ecc-homework-03/README.md)：昵称加 nonce 找哈希，原文验签成功、篡改失败。
4. [04 第一份 Counter 合约](firstcontract-04/README.md)：从 0 加到 5，分清读查询和写交易。
5. [05 ETH Bank](bank-05/README.md)：累计存款前三名；管理员提走资金后历史仍保留。
6. [06 BigBank](bigbank-06/README.md)：存款门槛、继承、接口与合约管理员；钱最终进 Admin。
7. [07 ERC20 TokenBank](tokenbank-07/README.md)：先授权 10，再存 10、取 4；看钱包、银行和个人账本。
8. [08 NFTMarket](tokenbankv2-08/README.md)：用 100 枚代币买 NFT，比较普通购买与转账回调。
9. [09 Foundry 工具实践](foundry-counter-09/README.md)：测试、模拟、部署、读取，理解各自证明什么。
10. [10 银行测试与 fork](bank-tokenbank-tests-10/README.md)：用本地副本验证 1,000 USDT 存取，不改变公共链。
11. [11 ERC721 与 IPFS](erc721-nft-11/README.md)：从 NFT 编号找到元数据和图片，区分持有人与管理员。
12. [12 转账历史索引](erc20-event-indexer-12/README.md)：事件入库、断点续扫、地址查询与重组恢复。
13. [13 TokenBank 全栈](tokenbank-fullstack-13/README.md)：页面、钱包、合约、后端和数据库怎样完成一笔存款。
14. [14 命令行钱包](cli-wallet-14/README.md)：构建 1.25 枚转账、检查费用、区分签名与广播。
15. [15 多签钱包](multisig-wallet-15/README.md)：三人两票，提交不自动确认，够票不自动执行。
16. [16 Permit / Permit2](eip712-permit-16/README.md)：签名授权、白名单购买，以及钱包支持时的 EIP-7702 批量存款。
17. [17 Meme 最小代理工厂](meme-factory-17/README.md)：共享代码、独立余额，固定批量铸币和 1% 分账。
18. [18 读取私有存储](esrnt-storage-18/README.md)：定位槽、拆出字段，理解 private 不等于加密。
19. [19 链表排行榜](linked-list-bank-19/README.md)：追加存款后移动节点，维护前十名与历史累计。
20. [20 Merkle 五折市场](merkle-nft-market-20/README.md)：证明在名单中，把 Permit 和购买打包成一笔交易。
21. [21 UUPS 可升级市场](upgradeable-nft-market-21/README.md)：保留代理账本、替换逻辑，再用签名订单成交。
22. [22 Vault 安全练习](vault-22/README.md)：在本地观察存储错位和重入如何导致资产损失。
23. [23 CRE 自动化](cre-project-23/README.md)：定时读状态，超过阈值划走一半；自动扣款同时减少可提余额。
24. [24 Vesting 分期解锁](vesting-24/README.md)：12 个月等待、24 期领取，区分累计解锁与本次可领。
25. [25 Uniswap V2](uniswap-v2-25/README.md)：加双币、兑换、交还 LP，沿资产变化理解自动兑换。

`tokenbankv2-08` 保留历史名称，实际讲 NFTMarket；不要根据目录名寻找 TokenBank 页面。

## 怎样执行文档中的命令

“仓库根目录”指能看到本文件和 25 个项目目录的位置。打开终端后先进入它；每个代码块若写了 `cd 项目名`，表示从根目录开始，不要在子目录反复执行同一个相对 cd。

```bash
pwd
git status --short
```

本仓库没有统一 `npm start`。只安装目标项目需要的工具：Node 作业和后端一般用 npm；前端用 pnpm；CRE 用 Bun；合约用 Foundry 或 Remix；数据库项目再准备 PostgreSQL。准确版本以目标 README 和配置为准。

Foundry 的 `forge test` 在临时 EVM 中跑测试，不需要先开 Anvil。Anvil 是持续运行的本机链；Remix VM 是浏览器里的模拟链；fork 是远程链状态的本地副本。三者都不能冒充公共链交易。

第一次使用终端，可以在编辑器中打开整个 `block-chain-list` 文件夹，再打开它的终端。`pwd` 显示当前位置，`cd` 切换目录，Ctrl+C 停止当前前台程序。多终端流程中的 A、B、C 是分别打开的终端，不是在同一窗口连续粘贴所有命令。

文中的 Shell 命令按 macOS / Linux 的 Bash 或 Zsh 编写；Windows 请使用 WSL 等相容环境。反斜杠 `\` 表示命令未结束，复制时带上后面的行。`<替换为地址>` 这类文字是占位提示，先替换成自己的公开值，再执行。

### 工具还没安装时

只准备当前练习需要的工具，按官方页面选择操作系统和项目要求的版本：

- **只试第一份合约**：可先用 [Remix 浏览器编辑器及说明](https://remix-ide.readthedocs.io/en/latest/)，在 Remix VM 里练习，不必先搭本机链。
- **跑合约测试**：按 [Foundry 安装指南](https://getfoundry.sh/introduction/installation/) 安装。`forge` 编译和测试，`anvil` 启动本地链，`cast` 查询和调用；用 `forge --version`、`anvil --version`、`cast --version` 检查。
- **跑 JavaScript / TypeScript**：安装 [Node.js](https://nodejs.org/en/download)，再检查 `node --version`、`npm --version`。需要前端时按 [pnpm 安装说明](https://pnpm.io/installation) 准备项目 `package.json` 中 `packageManager` 指定的版本，用 `pnpm --version` 核对。
- **运行 12、13、16 的数据库**：按 [PostgreSQL 下载页](https://www.postgresql.org/download/) 安装并启动服务。`psql --version` 只证明客户端存在，`pg_isready` 才检查服务能否连接；数据库名和连接方式看各项目指南。
- **可选分支**：01 的命令行聊天需要 [Python](https://www.python.org/downloads/)，23 的工作流需要 [Bun](https://bun.sh/docs/installation)。项目若要求 `jq`，它用于从 JSON 结果中取字段，也应先用 `jq --version` 检查。

`command not found` 表示工具未安装或终端找不到它，先修复这一步；安装后可能需要新开终端。不要把另一个项目的编译器、端口、数据库或锁文件直接套过来。

## 用什么标准判断自己学会了

每次练习做三件事：先预测结果，执行后核对数值，再制造一个可控失败。比如“取出 7，但可提只有 6”应整笔失败、余额不变。只看到页面提示或测试绿色，不如能解释状态为什么如此。

文档中的命令与数值区分为：**预期结果**供你复现；**历史记录**说明当时的版本和环境；**本次验证**只写实际执行过的检查。2026-10-09 补充源码注释后，已运行 274 项 Forge 测试、90 项 Node.js 测试、6 项本地集成测试和 2 项 Python 测试，均通过；另有 1 项需要指定 Delegator 字节码的集成场景跳过。也检查了文档链接、命令语法及受影响项目的格式、lint 和类型。没有操作公共链或浏览器钱包。

长流程的入口：

- [13 全栈操作](tokenbank-fullstack-13/WALKTHROUGH.md)与[请求恢复](tokenbank-fullstack-13/REQUESTS.md)。
- [16 签名存款操作](eip712-permit-16/WALKTHROUGH.md)与[Permit2 专题](eip712-permit-16/PERMIT2.md)。
- [25 沿三笔操作读源码](uniswap-v2-25/SOURCE_WALKTHROUGH.md)。

源码、历史部署和第三方依赖分别保留在原项目中。维护时遵守 [AGENTS](AGENTS.md) 与 [开发细则](DEVELOPMENT-RULES.md)；普通学习不必先读完开发规则。临时产物放 `output-tdd/`，不提交凭据或运行状态。公共链签名、转账、上传与部署是额外的真实操作，先核对网络、账户、目标和费用。

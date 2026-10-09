# TokenBank 历史环境与验证记录

以下保留原有日期、地址、余额和验证范围。它们不是当前在线状态，也不是本次文档重构重新执行的结果。旧启动命令仅供还持有对应链状态、配置和数据库的人辨认环境；首次学习请用 [新流程](WALKTHROUGH.md)。

## 1. 旧环境的地址与只读检查

这是 `3180` 页面使用的本地环境。2026-09-20 原 Anvil 停止后重新建链，并开启状态保存；旧链余额没有恢复。2026-09-21 在这条持续运行的链上新增了幂等版银行，复用原 Token 和数据库，页面已切换到新版。后续启动见[恢复方式](#2-当时重建后的启动方式)。

```text
页面：http://127.0.0.1:3180
Express API：http://127.0.0.1:13001/transfers
钱包 / 前端 / 索引器 RPC：http://127.0.0.1:18545
Chain ID：31337

当前 IdempotentTokenBank：0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
旧版 TokenBank（保留、只读）：0xe7f1725e7734ce288f8367e1bb143e90bb3f0512
Token：0x5FbDB2315678afecb367f032d93F642f64180aa3
Token 名称 / 符号 / 精度：BaseERC20 / BERC20 / 18
部署账户：0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
此前充值的钱包：0x000071424bb08b910f0786e04d964a63d64bf1ba
```

打开 [3180 页面](http://127.0.0.1:3180)，连接自己之前操作的账户，在 MetaMask 当前网站的网络设置中确认 RPC 是 `18545`。页面齿轮里的银行地址应与上面一致；添加自定义代币时则使用 **Token 地址**。之前转入的 100 BERC20 可能已经存入或取出，以现在的链上余额为准。

切换新版时，该钱包余额为 `94 BERC20`，旧银行存款为 `6 BERC20`，新银行存款为 `0`。这次没有迁移或取出旧存款；页面显示的是当前银行的存款，历史记录仍包含同一 Token 的旧交易。要查看旧银行，可在齿轮中临时输入旧地址；存取款请使用上面的新版地址。

下面只检查服务和读取数据，不部署、不转账。变量放在子 shell 内，避免影响之后新环境的配置：

```bash
lsof -nP -iTCP:18545 -iTCP:13001 -iTCP:3180 -sTCP:LISTEN
(
  TOKENBANK_PREVIEW_RPC=http://127.0.0.1:18545
  TOKENBANK_PREVIEW_BANK=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
  TOKENBANK_PREVIEW_TOKEN=0x5FbDB2315678afecb367f032d93F642f64180aa3
  TOKENBANK_PREVIEW_WALLET=0x000071424bb08b910f0786e04d964a63d64bf1ba

  cast chain-id --rpc-url "$TOKENBANK_PREVIEW_RPC"
  cast call --rpc-url "$TOKENBANK_PREVIEW_RPC" "$TOKENBANK_PREVIEW_BANK" 'token()(address)'
  cast call --rpc-url "$TOKENBANK_PREVIEW_RPC" "$TOKENBANK_PREVIEW_TOKEN" 'balanceOf(address)(uint256)' "$TOKENBANK_PREVIEW_WALLET"
  cast call --rpc-url "$TOKENBANK_PREVIEW_RPC" "$TOKENBANK_PREVIEW_BANK" 'balances(address)(uint256)' "$TOKENBANK_PREVIEW_WALLET"
  cast call --rpc-url "$TOKENBANK_PREVIEW_RPC" "$TOKENBANK_PREVIEW_TOKEN" 'balanceOf(address)(uint256)' "$TOKENBANK_PREVIEW_BANK"

  curl --fail --silent --show-error \
    "http://127.0.0.1:13001/transfers?address=$TOKENBANK_PREVIEW_WALLET&limit=10&offset=0" | jq
  curl --fail --silent --show-error \
    "http://127.0.0.1:3180/api/transfers?address=$TOKENBANK_PREVIEW_WALLET&limit=10&offset=0" | jq
)
```

链 ID 应为 `31337`，`token()` 应返回上面的 Token 地址。接下来三个整数依次是钱包余额、个人银行存款、银行总资产，除以 `10^18` 才是页面数量。API 中的 `chainId`、`tokenAddress` 应一致，`indexedThrough` 表示已扫描到的区块。链 ID 相同但 `token()` 读取失败，通常表示连到了空链或其他链实例。

如果**只有页面服务关闭**，确认 `18545` 和 `13001` 正常、`3180` 空闲后，可在新终端启动页面：

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
NEXT_PUBLIC_CHAIN_ID=31337 \
NEXT_PUBLIC_BANK_ADDRESS=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9 \
NEXT_PUBLIC_LOCAL_RPC_URL=http://127.0.0.1:18545 \
NEXT_PUBLIC_EXPLORER_URL='' \
INDEXER_URL=http://127.0.0.1:13001 \
pnpm --dir frontend dev --port 3180
```

不要同时在这个前端目录运行开发、构建和生产服务，它们会共用 `.next` 输出目录。页面已经正常运行时跳过上述启动命令，刷新即可。

旧链停止且没有保存状态时，合约地址和 PostgreSQL 转账记录不能恢复链上余额，需要重新部署。若只是索引器停止，需使用它原来的数据库和启动配置恢复。下面的 `18546 / 13002 / 3181` 是独立复现流程，与本节二选一。

## 2. 当时重建后的启动方式

Anvil 默认将数据放在内存中。启动空节点只创建测试账户，不会自动部署项目合约；因此钱包能连接，但银行读取会失败。只有首次建链或丢失链状态时才需要重新部署，现行步骤见[操作指南](WALKTHROUGH.md#3-终端-b部署-token-和-tokenbank)。当时仍由同一部署账户按相同顺序部署，账户 nonce 分别为 `0`、`1`，所以合约地址与旧环境相同，但链上数据属于新的一轮。

2026-09-20 重建时的初始状态（后续以实际操作为准）：

- `0x000071424bb08b910f0786e04d964a63d64bf1ba`：`10 ETH`、`100 BERC20`、个人银行存款 `0`。
- `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`：`99999900 BERC20`、个人银行存款 `0`。
- 银行总资产：`0 BERC20`。充值到钱包之后，还需要在页面点击“存入”并完成授权和存款，才会计入银行。
- 新索引数据库：`tokenbank_local_20260920_rebuilt`。旧记录保留在 `erc20_indexer` 数据库的 `tokenbank_ui_13891` schema，没有混入新环境。

运行数据仅保存在本机，不纳入 Git：

```text
../output-tdd/tokenbank-local-recovery/anvil-state.json   链状态
../output-tdd/tokenbank-local-recovery/session.env        本轮启动配置，无私钥
```

服务已经运行时，只需刷新页面。服务停止后，先确认相应端口空闲，再分别在三个终端运行以下命令；**不要重新部署或重复充值**。

终端 A：恢复同一份链状态，每秒保存一次，正常退出时也会保存。先检查文件，避免文件丢失时意外启动空链。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
test -s ../output-tdd/tokenbank-local-recovery/anvil-state.json && \
anvil --host 127.0.0.1 --port 18545 \
  --state ../output-tdd/tokenbank-local-recovery/anvil-state.json \
  --state-interval 1 --preserve-historical-states --silent
```

终端 B：恢复索引及操作服务，继续使用当时数据库与扫描进度。当前配置的 `BANK_ADDRESS` 指向新版银行，`PUBLIC_ORIGIN=http://127.0.0.1:3180`，因此同时启用 SIWE 登录与操作记录；不要再移除 `BANK_ADDRESS`，也不要填入旧银行地址。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
set -a
source ../output-tdd/tokenbank-local-recovery/session.env
set +a
env -u DATABASE_URL -u PGOPTIONS node backend/src/main.ts
```

终端 C：启动前端。当前前端使用本轮配置完成了生产构建，可以直接启动；修改过源码或 `NEXT_PUBLIC_` 配置时，先停止前端，再构建。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
set -a
source ../output-tdd/tokenbank-local-recovery/session.env
set +a
pnpm --dir frontend start --port 3180
```

构建命令为 `pnpm --dir frontend build`。不要在运行中的前端旁同时构建。保留状态文件、配置文件和 PostgreSQL 数据库；只有数据库或只有合约地址，都不能替代链状态文件。

2026-09-20 恢复验证时，曾停止并重新启动 Anvil，核对钱包余额、个人存款、银行总资产、区块哈希、充值回执、Transfer 日志和两个 API 入口，结果保持一致。2026-09-21 项目迁移保留了这个 Anvil 实例，只切换前后端程序，迁移前后三项余额和 API 历史记录一致。

2026-09-21 启用交互时，在区块 `11` 新增 `IdempotentTokenBank`，部署交易为 `0x25c415ca67ca50346c31ec80b2948dd28630a5410078a8ee37bc6c1670b90a7d`。本机的 `session.env`、`backend/.env` 和 `frontend/.env.local` 已同步新版地址；原有配置备份与部署回执保存在 `../output-tdd/tokenbank-local-interactive/`，均不纳入 Git。后端启动会核对银行的 Token 和幂等接口，前端则需要重新构建才能更新公开配置。Forge 的 4 项测试与使用独立 Anvil、隔离 PostgreSQL schema 的完整存取款集成测试通过；测试没有使用浏览器钱包签名，也没有动上述钱包或旧银行的资金。

## 3. 历史已执行验证的范围

2026-09-20 的前端验收使用真实 Anvil、现有 TokenBank / BaseERC20、本机 PostgreSQL、Express 和 Next.js，完成了精确金额存取款、分页、拒签、账户 / 网络切换、错误合约、接口错误、慢响应隔离以及不同屏幕宽度检查。浏览器自动化仅在测试浏览器中注入连接本地链的 EIP-1193 钱包，以控制拒签和账户切换；产品页面没有内置测试钱包或自动签名功能。

本指南补写时，另外启动独立端口与新数据库，实际核对了部署命令、100 BERC20 充值、两个 API 入口、存取款精确整数及 SQL 查询。文档中的“预期结果”用于你的本轮验收，不能把之前测试的截图、交易哈希或固定合约地址当成本轮已经执行成功的证据。

当时补充账户与银行说明时，检查了文档内部链接和 Bash / Zsh 命令语法，并实际执行旧环境的只读检查：旧链的银行与 Token 关系、三项余额、Express 与 Next.js 代理均可读取。当时文档检查没有重新部署、充值或发送存取款交易，也没有重新执行上述浏览器验收。

此前 `3180 / 13001 / 18545` 是上一轮测试环境；当前指南使用 `3181 / 13002 / 18546`。不要依赖 `../output-tdd/playwright/` 中未纳入版本管理的旧测试启动脚本，它们可能仍引用已经移除的 Vite。


### 2026-09-21：独立项目迁移验收

当时使用 `tokenbank-fullstack-13` 自己的合约、后端、数据库结构和前端，在隔离的 `18547 / 13003 / 3182` 端口及 PostgreSQL 临时 schema 完成以下实测：

- 页面从 100 BERC20 开始，存入 `10.000000000000000001`、取出 `4`；三项链上余额、PostgreSQL 原始整数、Express 和 Next.js 代理结果一致。
- 拒签后余额不变；切换未存款账户显示个人存款 0、相同银行总资产，超额取款被禁用；错误网络和错误合约阻止操作。
- 停止后端时页面明确显示 HTTP 502，链上余额仍可读取；恢复后端后继续展示记录。额外 8 次最小单位转账使分页结果为 10 + 1 条，前后翻页正常。
- 320、390、1280 像素视口无整页横向溢出。浏览器使用仅存在于测试会话的 EIP-1193 本地钱包；未操作真实钱包扩展的签名弹窗。
- 合约格式、编译和 2 项测试通过；后端 lint、格式、3 项普通测试和 1 项真实全栈集成通过；前端 lint、格式、类型检查、4 项普通测试、1 项本地链集成与生产构建通过。共享提交钩子在隔离 Git 副本中实际运行成功，未修改用户仓库暂存区。
- 原 NFTMarket 的 11 项测试及监听器语法检查通过。原 07、08、12 业务源码与迁移前哈希一致；钱包组件原有修改保留，仅迁移导入路径。

验收后已停止隔离测试服务，并恢复 `3180 / 13001`，继续连接原 `18545` 和 `tokenbank_local_20260920_rebuilt`。原钱包 `0x000071424bb08b910f0786e04d964a63d64bf1ba` 的钱包余额 `94`、个人存款 `6`、银行总资产 `6` BERC20 与迁移前一致，6 条钱包相关记录保持一致。上述数值只代表当时核对时刻，后续以实际链上状态为准。

### 2026-09-21：后端 TypeScript 迁移验收

后端源码和测试从 `.mjs` 迁移为 `.ts`，使用 Node.js 24.14.0 原生执行，严格类型检查覆盖两者。配置、HTTP、转账查询和扫描沿用现有职责划分，共享领域类型放在 `src/transfers/types.ts`。

- `npm ci`、lint、格式检查、`typecheck`、3 项普通测试与 1 项真实全栈集成通过；数据库测试使用随机 schema，包含连接串带 `search_path=public` 时的隔离验证。
- 共享提交钩子在隔离 Git 副本中通过，确认后端按暂存文件检查 → 类型检查 → 测试执行；原仓库暂存区未变化。
- `npm start` 与 `npm run scan` 均运行新入口。现有 `13001` 后端和 `3180` 前端代理在切换前后返回完全相同的 6 条钱包记录，扫描进度为区块 `10`；复用原 `18545` 节点和数据库。

本轮未修改前端页面，也未重新执行浏览器验收或前端生产构建；上节的页面验证属于此前独立项目迁移记录。

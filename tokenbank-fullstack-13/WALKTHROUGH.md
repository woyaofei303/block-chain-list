# Token Bank：从启动到验收的完整流程

这份指南复现本项目已经验证过的链路：部署 Token / TokenBank → 给钱包准备本地测试资产 → 扫描 Transfer 到 PostgreSQL → 连接页面 → 授权、存款、取款 → 对照链上、API 和数据库结果。

新版页面使用幂等版银行；旧部署保持原样并只读。新建环境按本指南部署 `IdempotentTokenBank`，另读 [请求、登录与恢复说明](REQUESTS.md)。

先阅读 [账户、代币、银行和请求流程](frontend/README.md#先理解账户代币和银行)，再选择下面的入口：

- 继续使用之前 `3180` 页面里的数据：先读[第 0 节](#0-继续使用上一轮数据)，再进行页面操作，不要重复部署和充值。
- 从零复现：按第 1～9 节完成本地流程。它使用独立 Anvil 和新建数据库，不需要公共网络 ETH，也不需要向终端提供钱包私钥。
- 服务已就绪：[连接钱包](#6-终端-d启动页面并连接钱包) → [存取款](#7-页面操作存款取款与余额验收) → [切换账户核对](#75-切换账户验证同一家银行)。
- 遇到异常：看[第 11 节](#11-按现象排查)。公共网络是另一条路径，见[第 10 节](#10-切换到-sepolia--base)。

## 0. 继续使用上一轮数据

这是 `3180` 页面使用的本地环境。2026-09-20 原 Anvil 停止后重新建链，并开启状态保存；旧链余额没有恢复。2026-09-21 在这条持续运行的链上新增了幂等版银行，复用原 Token 和数据库，页面已切换到新版。后续启动见[第 0.1 节](#01-本次重建后的启动方式)。

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

### 0.1 本次重建后的启动方式

Anvil 默认将数据放在内存中。启动空节点只创建测试账户，不会自动部署项目合约；因此钱包能连接，但银行读取会失败。只有首次建链或丢失链状态时才需要执行[第 3 节的部署命令](#3-终端-b部署-token-和-tokenbank)。本次仍由同一部署账户按相同顺序部署，账户 nonce 分别为 `0`、`1`，所以合约地址与旧环境相同，但链上数据属于新的一轮。

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

终端 B：恢复索引及操作服务，继续使用本次数据库与扫描进度。当前配置的 `BANK_ADDRESS` 指向新版银行，`PUBLIC_ORIGIN=http://127.0.0.1:3180`，因此同时启用 SIWE 登录与操作记录；不要再移除 `BANK_ADDRESS`，也不要填入旧银行地址。

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

## 1. 先确认环境与端口

本项目路径如下；换机器时，将后续命令中的这一段替换成你的项目根目录。

```text
/Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
```

在终端执行：

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
node --version
pnpm --version
forge --version
anvil --version
cast --version
jq --version
pg_isready -h 127.0.0.1 -p 5432
```

要求 Node.js 24+，前端锁定的包管理器是 pnpm 11.21.0；Foundry 提供 `forge`、`anvil`、`cast`。PostgreSQL 应显示 `accepting connections`。本机已有 PostgreSQL 16，继续使用这个服务即可；若未启动，先通过原有安装方式启动它。

本指南使用以下地址，避免与上一轮预览占用的端口混淆：

```text
Anvil RPC       http://127.0.0.1:18546      Chain ID 31337
Express API     http://127.0.0.1:13002     路径 /transfers
Next.js 页面    http://127.0.0.1:3181      路径 /api/transfers
PostgreSQL      127.0.0.1:5432
```

检查前三个端口是否已被占用：

```bash
lsof -nP -iTCP:18546 -iTCP:13002 -iTCP:3181 -sTCP:LISTEN
```

没有输出表示未发现监听进程。若已有本指南启动的进程，可接着使用；若被其他服务占用，换一组端口并同步修改下面的配置，不要直接结束不明进程。

安装依赖：

```bash
npm --prefix backend ci
pnpm --dir frontend install --frozen-lockfile
```

准备四个终端：A 运行 Anvil，B 部署合约和执行核对命令，C 运行索引器，D 运行前端。A、C、D 启动后保持运行。

## 2. 终端 A：创建本轮配置，启动本地链

**首次执行整段；同一轮不要重复覆盖配置。** 每次重新开始都会生成一个新数据库名。配置文件只保存本地地址与公开合约信息，不保存钱包密钥，也不覆盖项目已有 `.env`。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
mkdir -p ../output-tdd/tokenbank-walkthrough
cat > ../output-tdd/tokenbank-walkthrough/session.env <<EOF_CONFIG
RPC_URL=http://127.0.0.1:18546
CHAIN_ID=31337
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=tokenbank_walkthrough_$(date +%Y%m%d_%H%M%S)
HOST=127.0.0.1
PORT=13002
CONFIRMATIONS=0
BATCH_SIZE=100
POLL_INTERVAL_MS=1000
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_LOCAL_RPC_URL=http://127.0.0.1:18546
PUBLIC_ORIGIN=http://127.0.0.1:3181
NEXT_PUBLIC_EXPLORER_URL=
INDEXER_URL=http://127.0.0.1:13002
EOF_CONFIG
anvil --host 127.0.0.1 --port 18546 --silent
```

`--silent` 下没有持续输出是正常的。Anvil 默认随交易出块；本地配置 `CONFIRMATIONS=0`，索引器无需再等待 12 个区块。这里没有开启分叉或连接公共链。

`../output-tdd/` 由本仓库 `.git/info/exclude` 忽略，部署回执、编译缓存与本轮配置均存放在这里。

## 3. 终端 B：部署 Token 和 TokenBank

加载 A 创建的配置。`set -a` 让随后读取的变量传给子进程，新开的终端都需要执行相同的加载步骤。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
set -a
source ../output-tdd/tokenbank-walkthrough/session.env
set +a
cast chain-id --rpc-url "$RPC_URL"
```

必须返回 `31337`。接下来使用 Anvil 自带的解锁账户部署；这些 `--unlocked` 命令仅针对本指南的本地 RPC。

```bash
TOKENBANK_DEPLOYER="$(cast rpc --rpc-url "$RPC_URL" eth_accounts | jq -er '.[0]')"
forge create src/BaseERC20.sol:BaseERC20 \
  --root contracts \
  --rpc-url "$RPC_URL" --from "$TOKENBANK_DEPLOYER" \
  --unlocked --broadcast --json \
  > ../output-tdd/tokenbank-walkthrough/token-deployment.json
TOKEN_ADDRESS="$(jq -er '.deployedTo' ../output-tdd/tokenbank-walkthrough/token-deployment.json)"

forge create src/IdempotentTokenBank.sol:IdempotentTokenBank \
  --root contracts \
  --rpc-url "$RPC_URL" --from "$TOKENBANK_DEPLOYER" \
  --unlocked --broadcast --json --constructor-args "$TOKEN_ADDRESS" \
  > ../output-tdd/tokenbank-walkthrough/bank-deployment.json
BANK_ADDRESS="$(jq -er '.deployedTo' ../output-tdd/tokenbank-walkthrough/bank-deployment.json)"

TOKENBANK_DEPLOY_TX="$(jq -er '.transactionHash' ../output-tdd/tokenbank-walkthrough/token-deployment.json)"
START_BLOCK="$(cast to-dec "$(cast receipt --rpc-url "$RPC_URL" "$TOKENBANK_DEPLOY_TX" --json | jq -er '.blockNumber')")"
cat >> ../output-tdd/tokenbank-walkthrough/session.env <<EOF_CONTRACTS
TOKENBANK_DEPLOYER=$TOKENBANK_DEPLOYER
TOKEN_ADDRESS=$TOKEN_ADDRESS
BANK_ADDRESS=$BANK_ADDRESS
NEXT_PUBLIC_BANK_ADDRESS=$BANK_ADDRESS
START_BLOCK=$START_BLOCK
EOF_CONTRACTS
```

每条部署命令都应成功退出。若出现编译、RPC 或 JSON 解析错误，停在该步修复，不要继续使用空地址。`START_BLOCK` 从 **Token 的部署回执**读取，不能使用银行部署区块，也不能把十六进制区块直接写给索引器。

核对合约：

```bash
cast code --rpc-url "$RPC_URL" "$BANK_ADDRESS"
cast call --rpc-url "$RPC_URL" "$BANK_ADDRESS" 'token()(address)'
cast call --rpc-url "$RPC_URL" "$TOKEN_ADDRESS" 'symbol()(string)'
cast call --rpc-url "$RPC_URL" "$TOKEN_ADDRESS" 'decimals()(uint8)'
```

预期：银行字节码不是 `0x`；`token()` 等于本轮 `TOKEN_ADDRESS`；符号为 `BERC20`，精度为 `18`。TokenBank 没有创建新币，BaseERC20 的初始一亿枚代币全部属于部署账户。

## 4. 终端 B + 浏览器：准备自己的测试钱包

在安装了钱包扩展的浏览器中操作。Codex 内置预览可以展示页面，但未必能访问浏览器钱包扩展。

### 4.1 让钱包连接同一条本地链

在钱包的网络管理中添加或编辑：

```text
网络名称：TokenBank Local（可自行命名）
RPC URL：http://127.0.0.1:18546
Chain ID：31337
货币符号：ETH
区块浏览器：留空
```

如果钱包已有 Chain ID `31337` 的网络，务必核对 RPC 端口。旧的 `8545` 或 `18545` 与本轮 `18546` 是不同实例，即使链 ID 相同也不能混用。页面显示的网络名 `Foundry` 来自链配置，与钱包自定义名称不同不影响使用。

### 4.2 给自己的钱包准备 ETH 和 BERC20

选择一个用于测试的普通钱包账户，复制它的 **公开地址**。为便于核对第 7 节固定余额，请使用本轮尚未收到代币的账户，不要选择持有初始一亿枚的部署账户。在终端 B 替换下面的占位地址，然后校验；不需要导出或导入任何私钥。

```bash
WALLET_ADDRESS='0x替换为浏览器钱包当前账户地址'
cast to-check-sum-address "$WALLET_ADDRESS"
```

地址校验成功后，为它设置 10 个本地 ETH 并转入 100 BERC20。两条命令都只修改本轮 Anvil 的本地数据。`anvil_setBalance` 把 ETH 余额设为 10，并非追加 10；`transfer` 则实际追加 100 BERC20，重复执行会再次转账。ETH 用于之后授权、存款和取款的手续费。

```bash
cast rpc --rpc-url "$RPC_URL" anvil_setBalance "$WALLET_ADDRESS" 0x8ac7230489e80000
cast send --rpc-url "$RPC_URL" --from "$TOKENBANK_DEPLOYER" --unlocked \
  "$TOKEN_ADDRESS" 'transfer(address,uint256)' \
  "$WALLET_ADDRESS" 100000000000000000000 --json \
  > ../output-tdd/tokenbank-walkthrough/funding-receipt.json
printf '\nWALLET_ADDRESS=%s\n' "$WALLET_ADDRESS" >> ../output-tdd/tokenbank-walkthrough/session.env

cast balance --rpc-url "$RPC_URL" "$WALLET_ADDRESS" --ether
cast call --rpc-url "$RPC_URL" "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$WALLET_ADDRESS"
cast call --rpc-url "$RPC_URL" "$BANK_ADDRESS" 'balances(address)(uint256)' "$WALLET_ADDRESS"
```

预期：10 ETH、`100000000000000000000` 个 Token 最小单位、个人银行存款 `0`。`cast` 可能在整数后附带科学计数法提示，前面的完整整数才是核对值。

### 4.3 在 MetaMask 显示 BERC20

1. 确认 MetaMask 选择本轮的本地网络与第 4.2 节钱包账户。
2. 在代币列表的管理 / 导入入口选择添加自定义代币；扩展版本不同，入口名称可能不同。
3. 网络选本地链，代币合约地址填本轮 `TOKEN_ADDRESS`，符号 `BERC20`，精度 `18`，确认添加。
4. 应显示 `100 BERC20`；ETH 是另一项资产。后续存入银行会减少钱包中的 BERC20，取出才会增加。

可在终端 B 输出本轮代币地址以便复制：

```bash
printf '%s\n' "$TOKEN_ADDRESS"
```

不要填 `BANK_ADDRESS` 或钱包地址。导入代币只是显示已有资产，页面也会自行从合约读取信息，不依赖 MetaMask 是否手动添加。具体入口可参考 [MetaMask 官方添加代币说明](https://support.metamask.io/manage-crypto/tokens/how-to-display-tokens-in-metamask)。

## 5. 终端 C：创建独立数据库并启动索引器

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
set -a
source ../output-tdd/tokenbank-walkthrough/session.env
set +a
env -u DATABASE_URL -u PGOPTIONS createdb "$PGDATABASE"
env -u DATABASE_URL -u PGOPTIONS node backend/src/main.ts
```

数据库只在本轮第一次启动时创建；恢复运行时跳过 `createdb`。默认使用当前系统用户名连接，若本机 PostgreSQL 使用其他角色，先按实际情况设置 `PGUSER`，密码使用既有的本机认证方式。

这里直接启动 Node 入口，不加载索引器原有 `.env`；同时排除继承的 `DATABASE_URL` 与 `PGOPTIONS`，避免意外连到其他数据库或旧测试 schema。

成功后应出现：

```text
API ready at http://127.0.0.1:13002/transfers
Indexed through block ...
```

回到终端 B 检查 API：

```bash
curl --fail --silent --show-error \
  "http://127.0.0.1:13002/transfers?address=$WALLET_ADDRESS&limit=10&offset=0" | jq
```

核对 `chainId=31337`、`tokenAddress` 与本轮 Token 一致、`decimals=18`，并看到部署账户向钱包转入 `100` 的记录。`indexedThrough` 应至少达到充值回执的区块；若首次返回空数组，等下一轮扫描再查询。

## 6. 终端 D：启动页面并连接钱包

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
set -a
source ../output-tdd/tokenbank-walkthrough/session.env
set +a
pnpm --dir frontend dev --port 3181
```

在安装了钱包的浏览器打开 [本地页面](http://127.0.0.1:3181)，点击“连接钱包” → 具体的钱包名称（如 MetaMask），批准账户连接和目标网络切换。未发现具名钱包时才显示“浏览器钱包”入口。钱包账户必须与第 4 节的 `WALLET_ADDRESS` 相同。

点击页面右上角地址，核对完整地址、钱包名称、链 ID 和本地目标 RPC。若选错账户，在 MetaMask 中为**当前网站**选择正确账户；必要时点页面“断开并重新选择”再连接。页面中的目标 RPC 是配置提示，也需到 MetaMask 网络设置核对实际使用的 RPC。

页面应显示：我的钱包余额 `100 BERC20`、我的银行存款 `0 BERC20`、银行总资产 `0 BERC20`、本轮银行及 Token 地址、转入 `100` 的记录。若合约设置曾被手动修改，刷新页面恢复环境变量中的银行地址。

所有账户使用同一个银行合约。个人存款按当前钱包地址分别记账；银行总资产是合约实际持有的 BERC20，供所有账户共同查看，不能全部作为当前账户的可提额度。

终端 B 再查一次前端代理：

```bash
curl --fail --silent --show-error \
  "http://127.0.0.1:3181/api/transfers?address=$WALLET_ADDRESS&limit=10&offset=0" | jq
```

它应与 Express `/transfers` 的对应查询一致；两次请求间扫描进度可能推进，因此 `indexedThrough` 不一定完全相同。浏览器只请求同源 `/api/transfers`，Next.js 再访问 Express；浏览器不直接连接 PostgreSQL。

## 7. 页面操作：存款、取款与余额验收

下面预期值以一个刚收到 **100 BERC20、没有历史存款**的测试钱包为起点。请按顺序执行，不重复充值或重复存款。

### 7.1 存入 10.000000000000000001

1. 选择“存入”，输入 `10.000000000000000001`。
2. 点击“存入 Token”。没有足够授权时，钱包首先请求 `approve`，授权数额仅为本次金额。
3. 授权回执成功后，钱包再请求 `deposit`；确认存款。
4. 页面显示“存款已确认”，并重新读取余额。首次存款通常需要确认两笔交易；已有足够授权时只需要存款一笔。

预期结果：

```text
钱包余额：89.999999999999999999 BERC20
我的银行存款：10.000000000000000001 BERC20
银行总资产：10.000000000000000001 BERC20
新增 Transfer：钱包 → 银行
valueRaw：10000000000000000001
```

授权只产生 Approval，不会出现在 Transfer 列表；因此首次存款确认两笔交易，新增的存款转账记录仍只有一条。

### 7.2 取出 4

存款确认成功后，页面显示成功提示并自动清空金额、解锁表单。保持连接刚才存款的同一个钱包，直接选择“取出”，输入 `4`，点击“取出 Token”并在钱包确认。取款不需要再授权，也不需要填写接收地址；银行会自动退给发起取款的当前钱包。若当前是另一个没有存款的账户，切回原账户即可，银行合约地址不需要改。

```text
钱包余额：93.999999999999999999 BERC20
我的银行存款：6.000000000000000001 BERC20
银行总资产：6.000000000000000001 BERC20
新增 Transfer：银行 → 钱包
valueRaw：4000000000000000000
```

页面每 15 秒刷新记录，也可以点击“刷新记录”。当前本地索引器每秒扫描一次，通常在下一轮后可见；链上回执确认与索引入库是两个独立步骤。

### 7.3 用只读调用复核

终端 B：

```bash
cast call --rpc-url "$RPC_URL" "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$WALLET_ADDRESS"
cast call --rpc-url "$RPC_URL" "$BANK_ADDRESS" 'balances(address)(uint256)' "$WALLET_ADDRESS"
cast call --rpc-url "$RPC_URL" "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BANK_ADDRESS"
curl --fail --silent --show-error \
  "http://127.0.0.1:3181/api/transfers?address=$WALLET_ADDRESS&limit=10&offset=0" | jq
```

三个链上整数应分别为 `93999999999999999999`、`6000000000000000001`、`6000000000000000001`。本轮只有一个存款账户，个人存款与总资产恰好相同；其他账户存取款或直接向银行转币后，两者可能不同。API 按区块倒序显示取款、存款、充值。个人可提额度以 `balances(钱包地址)` 为准。

### 7.4 核对 PostgreSQL

终端 B 加载配置中的数据库名并进入只读事务：

```bash
set -a
source ../output-tdd/tokenbank-walkthrough/session.env
set +a
env -u DATABASE_URL -u PGOPTIONS psql "$PGDATABASE"
```

依次执行以下 SQL：

```sql
BEGIN READ ONLY;

SELECT chain_id, token_address, start_block, next_block,
       next_block - 1 AS indexed_through, block_hash
FROM scan_progress
WHERE chain_id = 31337;

SELECT block_number, transaction_hash, log_index,
       from_address, to_address, value_raw::text
FROM transfers
WHERE chain_id = 31337
ORDER BY block_number DESC, log_index DESC;

SELECT chain_id, token_address, transaction_hash, log_index, COUNT(*)
FROM transfers
GROUP BY chain_id, token_address, transaction_hash, log_index
HAVING COUNT(*) > 1;

COMMIT;
```

第三条查询应返回 0 行。数据库保存整个 Token 的 Transfer，包含部署时发给部署者的铸币；钱包 API 只返回与查询账户有关的记录，因此数据库总行数通常比该钱包的记录数多。退出 psql 后再执行后续终端命令：

```text
\q
```

### 7.5 切换账户，验证同一家银行

保持同一 RPC 和银行地址，在 MetaMask 中为当前网站选择另一个本轮没有存款的账户。这里只查看，不发送交易，因此新账户不需要先充值 ETH。

```text
刚才存款的账户：我的银行存款 6.000000000000000001，银行总资产 6.000000000000000001
没有存款的账户：我的银行存款 0，                    银行总资产 6.000000000000000001
```

新账户取款输入 `1` 应提示超余额，不能提交；切回原账户就能看到自己的存款。银行总资产在没有新交易时相同，个人存款随账户变化，说明两人共用一家银行、各自记账。核对后切回原账户，再进行第 8 节。

## 8. 复现此前测试中的异常与分页

### 输入与拒签

在个人银行存款为 `6.000000000000000001` 时：

- 取款输入 `7`：提示余额不足，不能提交。
- 输入 `0`、负数、`1e3`：不能提交。
- 输入 `0.0000000000000000001`：超过 18 位小数，不能提交。
- 取款输入 `1`，点击提交后在钱包拒绝：显示取消提示，钱包余额、个人银行存款和银行总资产不变。
- 存款时先确认授权，再拒绝存款：存款余额不变，已经确认的授权保留；刷新页面不会撤销授权。

### 账户、网络与合约

- 同一网络、同一银行合约下切换账户：显示各自的“我的银行存款”，但同一区块的“银行总资产”一致。未存款账户即使看到银行有总资产，也不能提取其他人的存款。
- 切换到另一个未充值账户：原账户的金额输入、余额及记录应被替换；新账户可以是真实的零余额和空记录。
- 切换到非目标网络：页面提示切换网络，存取款输入不可用。切回本轮本地 RPC 后恢复。
- 点击齿轮“银行合约设置”，输入 `invalid`：地址格式校验不通过。
- 填入本轮 Token 地址作为银行地址：余额读取失败，不能发交易；恢复 `BANK_ADDRESS` 后正常。
- 没有安装钱包的浏览器：点击连接会提示未检测到钱包，不会显示假余额。

### 后端故障与恢复

保持 A、D 运行，在终端 C 按 Ctrl+C 停止索引器，然后在页面点击“刷新记录”。应明确显示记录服务错误，链上余额读取和存取款仍可用。

若在此期间进行存取款，钱包成功回执才代表链上完成；恢复索引器后，它从保存的进度继续扫描，并补齐停机期间的 Transfer。重新执行终端 C 的加载配置和 Node 启动命令即可，**不要重复创建数据库**。

此前浏览器检查还验证了“记录请求延迟不会阻塞已确认交易的成功提示”。这项检查使用测试浏览器延迟 `/api/transfers` 响应，并未修改链上余额或伪造成功记录。

### 生成足够记录，检查分页

页面每页 10 条。为了在本轮钱包下产生足够记录，可在终端 B 由本地部署账户额外向钱包发送 8 次最小单位转账。这会使钱包 Token 余额总计增加 `0.000000000000000008`，个人银行存款和银行总资产不变；请在第 7 节固定余额验收之后执行。

```bash
for TOKENBANK_TRANSFER_INDEX in 1 2 3 4 5 6 7 8; do
  cast send --rpc-url "$RPC_URL" --from "$TOKENBANK_DEPLOYER" --unlocked \
    "$TOKEN_ADDRESS" 'transfer(address,uint256)' "$WALLET_ADDRESS" 1 --json \
    > "../output-tdd/tokenbank-walkthrough/pagination-$TOKENBANK_TRANSFER_INDEX.json"
done
```

刷新页面记录，点“下一页”。正常情况下，充值、存款、取款加上 8 条新记录共 11 条：第一页 10 条，第二页 1 条。若额外做过其他成功交易，以实际总数为准。

```bash
curl --fail --silent --show-error \
  "http://127.0.0.1:3181/api/transfers?address=$WALLET_ADDRESS&limit=10&offset=10" | jq
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  'http://127.0.0.1:13002/transfers?address=invalid'
```

第二条请求应返回 `400`。页面“上一页”应能返回；持续有新交易入库时，按 offset 分页的位置会变化，验收时先停止产生新交易。

最后在浏览器查看桌面和手机宽度。此前已检查 `320`、`390`、`1280` 像素下没有整页横向溢出；手机端转账表格可以横向滚动查看地址和交易列。

## 9. 自动检查、生产预览与停止

### 自动检查

从本项目根目录执行：

```bash
pnpm --dir frontend lint
pnpm --dir frontend format:check
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend test:integration
```

普通测试覆盖钱包拒绝、精确金额、响应校验、同源代理、并发取消、缓存重试、通知队列和操作恢复；数量以当前测试输出为准。集成测试有 1 项，自动启动独立 Anvil 并验证授权、存取款、拒签及账户 / 网络变化；结束后关闭该测试链，不依赖上面运行的 A，也不保留可供页面使用的合约。

索引器也有自己的检查（另运行 `npm --prefix backend run test:integration` 验证真实链、数据库与前端代理闭环）：

```bash
npm --prefix backend test
npm --prefix backend run lint
npm --prefix backend run format:check
npm --prefix backend run typecheck
```

索引器集成测试需要可连接的 PostgreSQL，在随机 schema 中运行并清理；不会替代本指南的浏览器操作验证。提交时仍由仓库现有 Husky 钩子执行暂存文件检查及相关类型检查、测试。

### 生产构建与启动

在 D 按 Ctrl+C 停止开发服务，保持 A、C 运行，再执行：

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/tokenbank-fullstack-13
set -a
source ../output-tdd/tokenbank-walkthrough/session.env
set +a
pnpm --dir frontend build
pnpm --dir frontend start --port 3181
```

重新检查页面以及 `/api/transfers`。生产环境同样需要 Next.js Node 服务，不能只把页面作为静态文件双击打开。`NEXT_PUBLIC_` 参数在构建时写入，修改链或银行地址后必须重新构建；`INDEXER_URL` 在服务端处理请求时读取。

### 停止与再次运行

- 仅重启前端或索引器：A 保持运行，重新加载同一份 `session.env` 后启动即可，不再部署、不再充值。
- 结束本轮：依次停止 D、C、A；保留本机 PostgreSQL 服务及数据库供后续核对。
- 本指南的 Anvil **没有开启状态持久化**。A 停止后重新启动是一条空链，不能把旧 `session.env` 当成仍然有效。重新从第 2 节开始，部署、充值并使用新生成的数据库名；旧数据库保留，不需要删除。
- 重置本地链后，钱包可能仍缓存旧交易或 nonce。确认只连接本轮本地网络后，按钱包提供的方法清理该测试网络的活动记录；重新连接并检查链上 nonce，不要反复提交同一笔待确认交易。

## 10. 切换到 Sepolia / Base

先完成本地验收。以下是另一条独立运行路径：使用一个**没有加载本地 `session.env` 的新终端**，否则 shell 环境变量会覆盖 `.env` / `.env.local`。

1. 确认目标链上已部署的 TokenBank，读取其 `token()`，与索引器目标 Token 核对。NFTMarket 不是 TokenBank。
2. 为该链 / Token 准备独立索引数据库；起始区块填写 Token 部署区块。
3. 按 [索引器 README](backend/README.md) 填写后端 `.env`，然后运行 `npm start`。
4. 按 [前端 README](frontend/README.md) 填写 `.env.local`，将 `INDEXER_URL` 指向这次启动的索引器。开发模式重启，生产模式重新构建再启动。
5. 钱包切到同一条链，准备该链上的 ETH 和实际 Token，按第 7 节执行。此处不再使用 Anvil 的 `anvil_setBalance` 或 `--unlocked` 命令。

已知配置：

```text
Sepolia
CHAIN_ID / NEXT_PUBLIC_CHAIN_ID = 11155111
TOKEN_ADDRESS = 0xaa0ce32d799459b6a617a0c07cfc79b4048e4dbc
START_BLOCK = 11702875
NEXT_PUBLIC_EXPLORER_URL = https://sepolia.etherscan.io

Base
CHAIN_ID / NEXT_PUBLIC_CHAIN_ID = 8453
TOKEN_ADDRESS = 0xaddf9b7e606ad7ad04d474b2e6c3af47696b662c
START_BLOCK = 必须从该 Token 实际部署回执确认
NEXT_PUBLIC_EXPLORER_URL = https://basescan.org
```

两种配置都需要自己确认 `NEXT_PUBLIC_BANK_ADDRESS`，当前指南不提供未经核实的公共网络银行地址。Base 的 NFTMarket 地址 `0x069b4ec66e0603b8ab012a5a2ec8a26cba4d3f16` 不能填入银行设置。

公共网络索引器默认等待 12 个确认区块，交易已成功但记录暂未显示时，先比较 `indexedThrough` 与交易所在区块，再检查确认数和扫描日志。不要将本地 `CONFIRMATIONS=0` 的等待表现与公共网络直接等同。

## 11. 按现象排查

- **MetaMask 显示本地网络，页面仍要求切换**：资产列表的网络筛选与当前网站使用的网络是两回事。在 MetaMask 右上角的已连接网站入口，为当前页面选择本地网络，并核对 RPC 端口。本指南使用 `18546`；上一轮 `3180` 页面使用 `18545`。参考 [MetaMask 官方网络切换说明](https://support.metamask.io/configure/networks/how-to-change-networks)。
- **网页地址与钱包不一致**：点击网页右上角地址，核对实际钱包名称与完整地址；点“断开并重新选择”，明确选择 MetaMask，并在该钱包的当前网站连接设置中选择要使用的账户。切换钱包资产页的展示账户不代表已更改网站授权。
- **切换网络提示已取消钱包请求**：钱包没有批准这次切换，余额仍不可读取。在选定的钱包中处理当前网站的切换请求后重试；这一步不涉及 Token 授权或转账。
- **无法连接 RPC**：检查 A 是否仍在运行，执行 `cast chain-id`。确认钱包 RPC、索引器 `RPC_URL` 和前端 `NEXT_PUBLIC_LOCAL_RPC_URL` 都指向同一端口。
- **页面只有破折号或钱包余额为 0**：先区分未连接、读取失败与真实零余额；检查当前钱包地址是否就是已充值的 `WALLET_ADDRESS`。
- **页面有 BERC20，MetaMask 里没有**：按第 4.3 节添加 Token，核对网络和完整 Token 地址；代币符号相同不代表是同一个合约。
- **钱包余额 0，但我的银行存款有 100**：代币已存入银行。在原账户下选择“取出”，输入不超过 100 的金额并确认，就会回到钱包。若需要全部取出，点“全部”；仍需有少量本地 ETH 支付手续费。
- **不同账户的银行余额不同**：看字段名称。个人存款按钱包地址记账；银行总资产应在同链、同合约、同一区块下一致，其他用户交易也会改变总资产。
- **我的银行存款为 0，但银行总资产很多**：这些不是当前账户的可提额度。可能属于其他账户，也可能是直接转到银行而未记账的 Token；本合约没有取回未记账转入资金的接口。
- **转入钱包成功，银行存款没有增加**：给钱包转币与存入银行是两步。按第 7.1 节在页面完成存款；仅导入代币、连接钱包或确认授权都不会增加存款。
- **`cast wallet list` 没有 Anvil 的账户**：它只列出 Foundry 本机密钥库。Anvil 提供的账户不会自动导入；`eth_accounts` 也只返回地址，不返回私钥。推荐按第 4.2 节给现有 MetaMask 账户充值，账户来源区别见 [README](frontend/README.md#anvilmetamask-和-foundry-账户有什么区别)。
- **银行数据读取失败**：用第 3 节的 `cast code` 和 `token()` 检查银行地址。空链、错误网络、Token 地址或 NFTMarket 地址都会失败。
- **索引器启动失败**：检查数据库是否已创建、PostgreSQL 角色是否可用，以及 `CHAIN_ID`、`TOKEN_ADDRESS`、`START_BLOCK`。不要把旧的 `DATABASE_URL` 或 schema 配置带入新流程。
- **API 是 200，但记录为空**：查看查询账户、Token 和 `indexedThrough`。未追到目标区块之前，空数组不代表链上没有转账。
- **页面提示后端配置不匹配**：对比 API 的 `chainId`、`tokenAddress`、`decimals` 与钱包和银行合约；仅修改页面银行地址不会同步修改后端索引目标。
- **API 502**：Next.js 无法访问索引器，检查 C、`INDEXER_URL` 和端口；先直接请求 Express，再请求 Next.js 代理。
- **存款只确认了一次就结束**：看成功的是授权还是存款。授权已成功、存款被拒绝时不会增加个人银行存款；已有足够授权时存款本来就只需一次确认。
- **等待确认超时**：页面最多等待约 180 秒；在钱包或公共链区块浏览器中先核对该交易，避免因超时重复发送。
- **本地没有区块浏览器链接**：本地配置特意留空，页面显示交易哈希；通过钱包或 `cast receipt --rpc-url "$RPC_URL" 完整交易哈希 --json` 查询。需要完整哈希时从钱包或 `/transfers` 响应复制。

## 12. 已执行验证的范围

2026-09-20 的前端验收使用真实 Anvil、现有 TokenBank / BaseERC20、本机 PostgreSQL、Express 和 Next.js，完成了精确金额存取款、分页、拒签、账户 / 网络切换、错误合约、接口错误、慢响应隔离以及不同屏幕宽度检查。浏览器自动化仅在测试浏览器中注入连接本地链的 EIP-1193 钱包，以控制拒签和账户切换；产品页面没有内置测试钱包或自动签名功能。

本指南补写时，另外启动独立端口与新数据库，实际核对了部署命令、100 BERC20 充值、两个 API 入口、存取款精确整数及 SQL 查询。文档中的“预期结果”用于你的本轮验收，不能把之前测试的截图、交易哈希或固定合约地址当成本轮已经执行成功的证据。

本次补充账户与银行说明时，检查了文档内部链接和 Bash / Zsh 命令语法，并实际执行第 0 节的只读检查：旧链的银行与 Token 关系、三项余额、Express 与 Next.js 代理均可读取。本次文档检查没有重新部署、充值或发送存取款交易，也没有重新执行上述浏览器验收。

此前 `3180 / 13001 / 18545` 是上一轮测试环境；当前指南使用 `3181 / 13002 / 18546`。不要依赖 `../output-tdd/playwright/` 中未纳入版本管理的旧测试启动脚本，它们可能仍引用已经移除的 Vite。


### 2026-09-21：独立项目迁移验收

本次使用 `tokenbank-fullstack-13` 自己的合约、后端、数据库结构和前端，在隔离的 `18547 / 13003 / 3182` 端口及 PostgreSQL 临时 schema 完成以下实测：

- 页面从 100 BERC20 开始，存入 `10.000000000000000001`、取出 `4`；三项链上余额、PostgreSQL 原始整数、Express 和 Next.js 代理结果一致。
- 拒签后余额不变；切换未存款账户显示个人存款 0、相同银行总资产，超额取款被禁用；错误网络和错误合约阻止操作。
- 停止后端时页面明确显示 HTTP 502，链上余额仍可读取；恢复后端后继续展示记录。额外 8 次最小单位转账使分页结果为 10 + 1 条，前后翻页正常。
- 320、390、1280 像素视口无整页横向溢出。浏览器使用仅存在于测试会话的 EIP-1193 本地钱包；未操作真实钱包扩展的签名弹窗。
- 合约格式、编译和 2 项测试通过；后端 lint、格式、3 项普通测试和 1 项真实全栈集成通过；前端 lint、格式、类型检查、4 项普通测试、1 项本地链集成与生产构建通过。共享提交钩子在隔离 Git 副本中实际运行成功，未修改用户仓库暂存区。
- 原 NFTMarket 的 11 项测试及监听器语法检查通过。原 07、08、12 业务源码与迁移前哈希一致；钱包组件原有修改保留，仅迁移导入路径。

验收后已停止隔离测试服务，并恢复 `3180 / 13001`，继续连接原 `18545` 和 `tokenbank_local_20260920_rebuilt`。原钱包 `0x000071424bb08b910f0786e04d964a63d64bf1ba` 的钱包余额 `94`、个人存款 `6`、银行总资产 `6` BERC20 与迁移前一致，6 条钱包相关记录保持一致。上述数值只代表本次核对时刻，后续以实际链上状态为准。

### 2026-09-21：后端 TypeScript 迁移验收

后端源码和测试从 `.mjs` 迁移为 `.ts`，使用 Node.js 24.14.0 原生执行，严格类型检查覆盖两者。配置、HTTP、转账查询和扫描沿用现有职责划分，共享领域类型放在 `src/transfers/types.ts`。

- `npm ci`、lint、格式检查、`typecheck`、3 项普通测试与 1 项真实全栈集成通过；数据库测试使用随机 schema，包含连接串带 `search_path=public` 时的隔离验证。
- 共享提交钩子在隔离 Git 副本中通过，确认后端按暂存文件检查 → 类型检查 → 测试执行；原仓库暂存区未变化。
- `npm start` 与 `npm run scan` 均运行新入口。现有 `13001` 后端和 `3180` 前端代理在切换前后返回完全相同的 6 条钱包记录，扫描进度为区块 `10`；复用原 `18545` 节点和数据库。

本轮未修改前端页面，也未重新执行浏览器验收或前端生产构建；上节的页面验证属于此前独立项目迁移记录。

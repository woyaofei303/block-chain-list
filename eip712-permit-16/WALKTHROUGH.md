# 从零运行与整体操作流程

本指南只在本地 Anvil 演示，沿用已有实现，所有业务入口位于 `eip712-permit-16`。先看 [项目总览](README.md) 理解签名区别，再按下面顺序操作。每个新终端先进入同一项目目录；命令默认 Bash / Zsh。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
```

## 本地参数统一入口

已有环境的参数集中在 [session.env](../output-tdd/eip712-consolidate/demo/session.env)，每项都有中文备注。钱包公开地址填入 `PRACTICE_WALLET`，待查交易哈希填入 `PRACTICE_TX_HASH`；RPC、合约地址、模拟账户、充值金额、NFT 订单参数、前后端与数据库配置也在同一个文件中维护。两个个人输入项默认留空，不填私钥或助记词。

每个新终端，以及每次修改配置后，都先加载下面这份文件。`PRACTICE_RUN` 保存绝对路径，不再随当前终端目录变化。首次尚无配置时，先执行第 2、3 节生成；已有环境跳过生成，直接编辑并加载。

```bash
set -a
source /Users/julian/Documents/Codex/2026-09-03/block-chain-list/output-tdd/eip712-consolidate/demo/session.env
set +a
```

`WHITELIST_NONCE`、`WHITELIST_DEADLINE`、`WHITELIST_DATA`、`WHITELIST_SIGNATURE` 是每次签名前读取或计算的临时值，其用途也备注在 env 中。它们由第 6 节命令生成，不把旧签名或旧 nonce 固定为下次交易的配置。修改服务配置后须重启对应服务；修改 env 本身不会充值、改挂单或发交易。

## 1. 环境与安装

需要 Node.js 24+、pnpm 11.21.0、npm、Foundry（forge / cast / anvil）、PostgreSQL（createdb / psql）和 jq。先检查本机已安装工具，不为本题另装钱包或导入私钥：

```bash
node --version
pnpm --version
npm --version
forge --version
cast --version
anvil --version
psql --version
jq --version
pg_isready -h 127.0.0.1 -p 5432
pnpm --dir frontend install --frozen-lockfile
npm --prefix backend ci
forge build --root contracts
```

前端与后端保留各自原锁文件。若 pnpm 提示缓存 SQLite 只读，可将本次缓存放到已忽略的运行目录，不改全局权限：

```bash
pnpm --dir frontend install --frozen-lockfile --store-dir "$PWD/../output-tdd/eip712-consolidate/pnpm-store"
```

本次约定 RPC `8547`、后端 `13016`、页面 `3016`；检查未被占用。已运行本题环境时先按第 8 节恢复，不重复部署。不停止不明进程。

```bash
lsof -nP -iTCP:8547 -iTCP:13016 -iTCP:3016 -sTCP:LISTEN
```

## 2. 终端 A：启动持久化本地链

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
if [ -f ../output-tdd/eip712-consolidate/demo/session.env ]; then
  set -a
  source ../output-tdd/eip712-consolidate/demo/session.env
  set +a
else
  export PRACTICE_RUN="$(git rev-parse --show-toplevel)/output-tdd/eip712-consolidate/demo"
fi
mkdir -p "$PRACTICE_RUN"
anvil --host 127.0.0.1 --port 8547 --chain-id 31337 --silent \
  --state "$PRACTICE_RUN/anvil-state.json" --state-interval 10 \
  --preserve-historical-states
```

保持 A 运行。`--silent` 避免打印测试密钥；`--state` 在存在文件时加载，退出时保存。链状态、配置和数据库需要成组保留，地址文件本身不能恢复余额；历史日志与回执是否可用仍需恢复后核实。

## 3. 终端 B：部署、铸造与上架（仅首次）

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
if [ -f ../output-tdd/eip712-consolidate/demo/session.env ]; then
  set -a
  source ../output-tdd/eip712-consolidate/demo/session.env
  set +a
else
  export PRACTICE_RUN="$(git rev-parse --show-toplevel)/output-tdd/eip712-consolidate/demo"
fi
cast chain-id --rpc-url http://127.0.0.1:8547
```

链 ID 应为 `31337`。部署脚本也会检查回环 HTTP、chain ID 和解锁模拟账户。首次执行下面命令，将 JSON 保存到新文件；文件已存在时不会再次部署：

```bash
if [ -e "$PRACTICE_RUN/deployment.json" ]; then
  printf '%s\n' '已有部署文件，请执行第 8 节恢复检查，不重复部署。'
else
  node frontend/scripts/permit-setup.mts > "$PRACTICE_RUN/deployment.json"
fi
jq . "$PRACTICE_RUN/deployment.json"
```

脚本按顺序部署 JUL、幂等银行、Blocklight Genesis、白名单市场；seller 同时是部署者、NFT owner 和项目签名方，buyer 获得 1000 JUL；seller 铸造 NFT #0 并以 100 JUL 上架。没有向公共链广播。

如果命令中断或 JSON 无法解析，先查本地节点与回执，不能删除文件后盲目重发。确认这只是一次全新的、可放弃的本地演示后，可另选运行目录重新开始。

从公开部署地址生成带用途备注的整组配置；已有文件会保留。首次生成后，在文件中填写自己的 `PRACTICE_WALLET`，之后统一编辑此文件并重新加载：

```bash
if [ ! -e "$PRACTICE_RUN/session.env" ]; then
  jq -er --arg run "$(cd "$PRACTICE_RUN" && pwd -P)" '
    "# 本机配置；由 shell source 加载，只保存公开地址和运行参数。",
    "# 本轮链状态、部署记录和配置的绝对目录；移动仓库后更新，不能指向另一条链。",
    "PRACTICE_RUN=" + ($run | @sh),
    "# 本地 Anvil RPC；部署脚本固定使用 8547，钱包也必须连接同一实例。",
    "RPC_URL=" + .rpc,
    "# 本练习固定的本地链 ID；相同 chain ID 不代表相同链状态。",
    "CHAIN_ID=" + (.chainId | tostring),
    "# JUL ERC20Permit 合约；充值、付款、余额查询和索引器使用。",
    "TOKEN_ADDRESS=" + .token,
    "# 幂等 TokenBank 合约；存款、提款及个人可提余额查询使用。",
    "BANK_ADDRESS=" + .bank,
    "# Blocklight Genesis ERC721 合约；查询 NFT owner 使用。",
    "NFT_ADDRESS=" + .nft,
    "# 白名单 NFT 市场；查询挂单、付款授权和 permitBuy 使用。",
    "MARKET_ADDRESS=" + .market,
    "# Anvil 第一个模拟账户；部署者、NFT 卖家、项目方白名单签名者及充值来源。",
    "SELLER=" + .seller,
    "# Anvil 第二个模拟账户；CLI NFT 买家，部署时已分配 1000 JUL。",
    "BUYER=" + .buyer,
    "# 浏览器使用的银行地址；必须与 BANK_ADDRESS 相同。",
    "NEXT_PUBLIC_BANK_ADDRESS=" + .bank,
    "# 浏览器的钱包目标链；必须与 CHAIN_ID 相同。",
    "NEXT_PUBLIC_CHAIN_ID=" + (.chainId | tostring),
    "# 浏览器读取本地链的 RPC；必须与 RPC_URL 指向同一实例。",
    "NEXT_PUBLIC_LOCAL_RPC_URL=" + .rpc
  ' "$PRACTICE_RUN/deployment.json" > "$PRACTICE_RUN/session.env"
  cat >> "$PRACTICE_RUN/session.env" <<'ENV'
# 浏览器钱包公开地址：填写你实际连接页面的账户，不是私钥，不自动使用 BUYER。
PRACTICE_WALLET=
# 待查询回执的公开交易哈希；第 7 节使用，执行交易后再填写。
PRACTICE_TX_HASH=
# 给页面测试钱包设置的模拟 ETH 余额，十六进制 wei；默认 1 ETH，覆盖余额而非累加。
PRACTICE_ETH_BALANCE_HEX=0xDE0B6B3A7640000
# 从 SELLER 转给页面测试钱包的 JUL 数量，18 位最小单位；默认 1000 JUL，每次执行均会转账。
PRACTICE_JUL_AMOUNT_WEI=1000000000000000000000
# CLI 购买目标 NFT 编号；部署脚本铸造并上架 #0，改值不会自动铸造或上架。
NFT_TOKEN_ID=0
# CLI 白名单签名及付款授权的 JUL 价格，18 位最小单位；默认 100 JUL，必须等于链上挂单价。
NFT_PRICE_WEI=100000000000000000000
# CLI 白名单签名有效期，秒；截止时间基于链上最新区块时间计算，默认 20 分钟。
WHITELIST_TTL_SECONDS=1200
# WHITELIST_NONCE：第 6 节从市场读取 BUYER 当前 nonce；成交后变化，不保存旧值。
# WHITELIST_DEADLINE：第 6 节计算的 Unix 截止时间；每次签名前重新计算。
# WHITELIST_DATA：第 6 节根据域、订单、nonce、截止时间构造的 EIP-712 JSON。
# WHITELIST_SIGNATURE：第 6 节由 SELLER 签署的结果；仅在当前终端使用，不写入此文件。

# 本地链没有公共区块浏览器；留空隐藏页面的浏览器链接。
NEXT_PUBLIC_EXPLORER_URL=
# Next.js 服务端代理的后端地址；端口必须与下面的 PORT 相同。
INDEXER_URL=http://127.0.0.1:13016
# PostgreSQL 主机；认证继续使用本机既有配置，不在这里保存密码。
PGHOST=127.0.0.1
# PostgreSQL 端口。
PGPORT=5432
# 本轮持久数据库名；恢复原链继续用原库，新链使用独立数据库。
PGDATABASE=tokenbank_permit_16
# Express 后端监听主机，仅本机可访问。
HOST=127.0.0.1
# Express 后端端口；修改时同步 INDEXER_URL。
PORT=13016
# Next.js 页面端口；修改时同步 PUBLIC_ORIGIN 和浏览器访问地址。
FRONTEND_PORT=3016
# SIWE 与写接口允许的页面来源；协议、主机、端口须与浏览器完全一致。
PUBLIC_ORIGIN=http://127.0.0.1:3016
# 索引起始区块；此本地演示从 0 开始扫描。
START_BLOCK=0
# 索引确认数；0 仅用于本地按交易出块的 Anvil。
CONFIRMATIONS=0
# 索引器每批扫描的最大区块数。
BATCH_SIZE=100
# 索引器轮询间隔，毫秒；1000 表示 1 秒。
POLL_INTERVAL_MS=1000
ENV
fi
set -a
source "$PRACTICE_RUN/session.env"
set +a
cast code "$BANK_ADDRESS" --rpc-url "$RPC_URL"
cast call "$BANK_ADDRESS" 'token()(address)' --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'decimals()(uint8)' --rpc-url "$RPC_URL"
cast call "$MARKET_ADDRESS" 'whitelistSigner()(address)' --rpc-url "$RPC_URL"
```

银行代码不能是 `0x`；银行 token 应等于本轮 `TOKEN_ADDRESS`；JUL 精度为 `18`；项目签名地址为 `SELLER`。这一步防止把 NFTMarket 当银行，或把相同 chain ID 的不同 Anvil 实例混在一起。

## 4. 终端 C / D：启动后端与页面

终端 C：

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
set -a
source ../output-tdd/eip712-consolidate/demo/session.env
set +a
```

仅在首次运行且数据库名尚未使用时创建；若已存在，先确认就是此链与 Token 的数据库，不清空也不混用：

```bash
env -u DATABASE_URL -u PGOPTIONS createdb "$PGDATABASE"
```

创建完成或确认原数据库后启动。这里直接运行已有 Node 入口，避免加载其他 `.env`；认证用户名/密码使用本机 PostgreSQL 的既有配置：

```bash
env -u DATABASE_URL -u PGOPTIONS node backend/src/main.ts
```

服务会检查链、Token、银行并幂等建表，开始索引。保持 C 运行。操作写接口依赖后端与 SIWE，会话可用不代表 Token 已授权。

终端 D：

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
set -a
source ../output-tdd/eip712-consolidate/demo/session.env
set +a
pnpm --dir frontend dev --port "$FRONTEND_PORT"
```

打开 [TokenBank](http://127.0.0.1:3016)。必须使用这个 origin，`localhost` 与 `127.0.0.1` 不等价。shell 中公开配置优先于 `.env.local`，不需要覆盖任何历史配置。也可以使用本目录的 `.env.example` 配置日常运行，但不要混用两组环境。

## 5. 钱包与 Permit 存款

钱包添加本地网络：RPC `http://127.0.0.1:8547`、chain ID `31337`、符号 `ETH`。使用自己的隔离测试钱包，只复制公开地址；无需导入 Anvil 私钥。

先在本地 `session.env` 填写 `PRACTICE_WALLET`，然后在终端 B 重新加载，为该公开地址分配模拟 ETH 与 JUL（首次一次；以下余额说明使用 env 默认充值金额）：

```bash
set -a
source /Users/julian/Documents/Codex/2026-09-03/block-chain-list/output-tdd/eip712-consolidate/demo/session.env
set +a
cast rpc anvil_setBalance "${PRACTICE_WALLET:?请先在 session.env 填写钱包公开地址}" "$PRACTICE_ETH_BALANCE_HEX" --rpc-url "$RPC_URL"
cast send "$TOKEN_ADDRESS" 'transfer(address,uint256)' "${PRACTICE_WALLET:?请先在 session.env 填写钱包公开地址}" "$PRACTICE_JUL_AMOUNT_WEI" \
  --unlocked --from "$SELLER" --rpc-url "$RPC_URL"
```

页面按以下顺序操作：

1. 连接钱包，核对页头账户、网络和银行地址；余额应为 1000 JUL、个人存款 0、银行资产 0（仅适用于尚未操作的新环境）。
2. 输入 `10.000000000000000001`，选择“签名授权”，点击“签名并存入”。首次先完成 SIWE，再签 Permit，最后确认存款交易。
3. Permit 只授权本次金额，有效期 20 分钟；签名不花 Gas，最终存款交易需要 Gas，无需先发 approve 交易。
4. 成功后钱包为 `989.999999999999999999`，个人存款为 `10.000000000000000001`。切到“取出”，输入 `4` 并确认，个人存款变为 `6.000000000000000001`，钱包为 `993.999999999999999999`。
5. 普通授权存款仍可选择；拒签、超额、账户/网络变化时不能误报成功。刷新/终止后先核实原操作，不生成新编号重复扣款。

上述余额是新环境的预期结果，不是当前钱包的实时状态。多次充值或操作后以实际链上读取为准。可在钱包手动添加本轮 `TOKEN_ADDRESS` 来显示 JUL，不改变余额。

## 6. 命令行白名单购买 NFT

在终端 B 已加载 session.env 的情况下执行。此演示使用 Anvil 的第二个解锁账户 `BUYER`，与第 5 节的个人测试钱包可以不同。它拥有初始 1000 JUL。先检查挂单和 NFT owner：

```bash
cast call "$NFT_ADDRESS" 'ownerOf(uint256)(address)' "$NFT_TOKEN_ID" --rpc-url "$RPC_URL"
cast call "$MARKET_ADDRESS" 'listings(uint256)(address,uint256)' "$NFT_TOKEN_ID" --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BUYER" --rpc-url "$RPC_URL"
```

新环境应分别为 seller、seller + `100000000000000000000`、`1000000000000000000000`。若已经成交，不重复运行购买；复习完整成功路径可直接使用第 9 节自动测试。

按真实链上 nonce 和时间构造 typed data，字段与合约完全一致。以下签名只由本地 Anvil 模拟账户完成，不连接用户的钱包扩展：

```bash
export WHITELIST_NONCE="$(cast call "$MARKET_ADDRESS" 'nonces(address)(uint256)' "$BUYER" --rpc-url "$RPC_URL" | awk '{print $1}')"
export WHITELIST_DEADLINE="$(( $(cast block latest --field timestamp --rpc-url "$RPC_URL") + WHITELIST_TTL_SECONDS ))"
export WHITELIST_DATA="$(jq -nc \
  --arg market "$MARKET_ADDRESS" --arg buyer "$BUYER" --arg seller "$SELLER" \
  --argjson chainId "$CHAIN_ID" --arg tokenId "$NFT_TOKEN_ID" --arg price "$NFT_PRICE_WEI" \
  --arg nonce "$WHITELIST_NONCE" --arg deadline "$WHITELIST_DEADLINE" '
  {
    domain: {name:"Julian NFT Market",version:"1",chainId:$chainId,verifyingContract:$market},
    primaryType:"Whitelist",
    types: {
      EIP712Domain:[
        {name:"name",type:"string"},{name:"version",type:"string"},
        {name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}
      ],
      Whitelist:[
        {name:"buyer",type:"address"},{name:"seller",type:"address"},
        {name:"tokenId",type:"uint256"},{name:"price",type:"uint256"},
        {name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}
      ]
    },
    message:{buyer:$buyer,seller:$seller,tokenId:$tokenId,price:$price,nonce:$nonce,deadline:$deadline}
  }')"
export WHITELIST_SIGNATURE="$(cast rpc eth_signTypedData_v4 "$SELLER" "$WHITELIST_DATA" --rpc-url "$RPC_URL" | jq -er .)"
```

实际项目由项目方在自己的钱包签署，再把签名交给 buyer；不能将项目私钥放进前端。签名只批准订单，买家还需授权付款。先模拟、再以本地账户发送：

```bash
cast send "$TOKEN_ADDRESS" 'approve(address,uint256)' "$MARKET_ADDRESS" "$NFT_PRICE_WEI" \
  --unlocked --from "$BUYER" --rpc-url "$RPC_URL"
cast call "$MARKET_ADDRESS" 'permitBuy(uint256,uint256,bytes)' "$NFT_TOKEN_ID" "$WHITELIST_DEADLINE" "$WHITELIST_SIGNATURE" \
  --from "$BUYER" --rpc-url "$RPC_URL"
cast send "$MARKET_ADDRESS" 'permitBuy(uint256,uint256,bytes)' "$NFT_TOKEN_ID" "$WHITELIST_DEADLINE" "$WHITELIST_SIGNATURE" \
  --unlocked --from "$BUYER" --rpc-url "$RPC_URL"
cast call "$NFT_ADDRESS" 'ownerOf(uint256)(address)' "$NFT_TOKEN_ID" --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BUYER" --rpc-url "$RPC_URL"
cast call "$MARKET_ADDRESS" 'nonces(address)(uint256)' "$BUYER" --rpc-url "$RPC_URL"
```

新环境成交后：NFT owner 为 BUYER、buyer 余额 900 JUL、市场 nonce 为 1；seller 收到 100 JUL，挂单清除。相同签名、其他买家、篡改价格、过期签名、跨链/跨市场使用均不能再次完成原订单。签名重放与失败回滚由自动测试覆盖。

## 7. 核对链、API 与数据库

在终端 B，用第 5 节真实参与存取款的 `PRACTICE_WALLET` 查询。命令均只读：

```bash
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "${PRACTICE_WALLET:?请先在 session.env 填写钱包公开地址}" --rpc-url "$RPC_URL"
cast call "$BANK_ADDRESS" 'balances(address)(uint256)' "${PRACTICE_WALLET:?请先在 session.env 填写钱包公开地址}" --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BANK_ADDRESS" --rpc-url "$RPC_URL"
curl --fail --silent --show-error \
  "$INDEXER_URL/transfers?address=${PRACTICE_WALLET:?请先在 session.env 填写钱包公开地址}&limit=10&offset=0" | jq
curl --fail --silent --show-error \
  "$PUBLIC_ORIGIN/api/transfers?address=${PRACTICE_WALLET:?请先在 session.env 填写钱包公开地址}&limit=10&offset=0" | jq
env -u DATABASE_URL -u PGOPTIONS psql "$PGDATABASE" -v ON_ERROR_STOP=1 -f database/verify.sql
```

SQL 在只读事务中核对扫描进度、转账与重复行；重复行查询应为空。金额保留原始最小单位，不能转为浮点数。NFT owner 另用第 6 节命令核对，后端没有 NFT 索引。

查询某个页面显示的交易回执：在 `session.env` 填写 `PRACTICE_TX_HASH` 并重新加载后执行：

```bash
cast receipt "${PRACTICE_TX_HASH:?请先在 session.env 填写交易哈希}" --rpc-url "$RPC_URL" --json
```

## 8. 停止、恢复与故障处理

- 停止顺序：D 前端 Ctrl+C → C 后端 Ctrl+C → A Anvil Ctrl+C，让链状态正常落盘。不要停止共享 PostgreSQL，也不要删除数据库。
- 恢复：A 运行第 2 节同一条命令加载同一状态文件；B/C/D 加载原 session.env，核对 chain ID、银行 token()、NFT owner 与余额，再启动 C/D。跳过部署、createdb 和充值。
- 状态文件丢失或合约代码变成 `0x`：旧地址和数据库不能恢复资产。保留旧产物，在明确的新运行目录和新数据库建立另一组环境，不能把旧索引混入新链。
- 旧回执或历史日志在恢复后不可用时，不把本地数据库记录当成链上证明；保留本轮测试日志。需要从零复现完整索引时使用新的独立链和数据库。
- 普通开发/生产重启无需重建链；修改公开环境变量后开发服务重启、生产服务重新 build。同一前端目录不要同时 dev/build/start。

生产运行替换终端 D 的启动命令：

```bash
pnpm --dir frontend build
pnpm --dir frontend start --port "$FRONTEND_PORT"
```

常见问题：

- 签名选项不可选：确认连接成功、使用 JUL 与更新后的幂等银行；历史 BaseERC20 没有 Permit。
- 页面报后端不匹配：核对前后端银行、Token、chain ID 和 RPC 地址；相同 chain ID 不足以证明同一节点。
- SIWE / 写接口拒绝：确认 C 正常运行、`BANK_ADDRESS` 已配置、浏览器 origin 等于 `PUBLIC_ORIGIN`。后端离线时不能完成页面写操作闭环。
- API 502：先检查 C，再检查 D 的 `INDEXER_URL`；索引暂未追上时对比 indexedThrough 与交易区块。
- 拒签或等待超时：先核实原操作/回执。不要把终止请求当成撤销交易，也不要盲目重发。
- 白名单失败：核对 seller、buyer、tokenId、price、nonce、deadline 和 Market 域；NFT 授权与 JUL 授权缺一不可。
- PostgreSQL 连接失败：确认服务、角色、数据库名和本机认证配置。不要在日志或文档中粘贴密码。

## 9. 全套验证与作业日志

以下均在本项目根目录执行。集成测试自动使用独立 Anvil；后端测试使用临时 PostgreSQL schema，默认本机 postgres 数据库。需要其他测试库时通过 PGHOST / PGDATABASE 等标准变量配置。测试退出后清理自己创建的节点和 schema。

```bash
forge fmt --root contracts --check
forge build --root contracts
forge test --root contracts -vvv
pnpm --dir frontend lint
pnpm --dir frontend format:check
pnpm --dir frontend typecheck
pnpm --dir frontend test
pnpm --dir frontend test:integration
pnpm --dir frontend test:permit
npm --prefix backend run lint
npm --prefix backend run format:check
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run test:integration
TEST_PERMIT=1 npm --prefix backend run test:integration
```

停止 D 后单独验证生产构建：

```bash
pnpm --dir frontend build
```

生成可见 Token / NFT 转移的证据，不要求截图：

```bash
mkdir -p ../output-tdd/eip712-review
set -o pipefail
forge test --root contracts -vvv | tee ../output-tdd/eip712-review/forge-test.log
forge test --root contracts --match-test 'testPermitDepositTransfersTokensWithoutApprove|testPermitBuyTransfersPaymentAndNFT' -vvvv | tee ../output-tdd/eip712-review/transfers.log
pnpm --dir frontend test:permit 2>&1 | tee ../output-tdd/eip712-review/permit-integration.log
TEST_PERMIT=1 npm --prefix backend run test:integration 2>&1 | tee ../output-tdd/eip712-review/fullstack-permit.log
```

前两项输出存款前后余额、NFT owner、付款余额和 Transfer 调用；RPC 测试输出真实本地交易哈希，直接解码并断言回执中的 ERC20 / ERC721 Transfer。全栈测试执行页面使用的 `executeIntent`，验证 SIWE、登记、存款、丢失哈希后的原编号恢复、提款、SQL 索引、同源查询和过期 Permit 回滚核实；只有 origin/cookie 使用 Node 适配，链与数据库均为真实本地服务。它们不是公共链证明，也不等同于真实钱包扩展的人工点击验收。

共享钩子仍在仓库 `multi-chat-py-01/web/.husky`，对本项目前后端先运行暂存文件 Biome，再执行类型检查和普通测试；合约改动运行 Forge。完整 RPC 测试单独执行。无需手工改 hooksPath，也没有本题独立 Git 仓库。

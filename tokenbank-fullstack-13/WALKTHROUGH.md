# TokenBank 实操：从本地链到网页存取款

先读 [README](README.md)。这次目标是给浏览器钱包准备 100 BERC20，存入 10，再取出 4，最后看到钱包 94、个人存款 6、银行资产 6。

整条流程只用本地 Anvil。每个终端都从仓库根目录进入 `tokenbank-fullstack-13`；变量不会自动跨终端共享，因此下面让各终端加载同一份公开配置。

## 0. 继续使用上一轮数据

如果已经做过练习，先找到同一轮的链状态文件、配置和数据库，不重新部署或充值。端口相同、chain ID 相同，不代表恢复了旧状态；查询银行代码、`token()` 和余额确认后再继续。

旧 `3180 / 13001 / 18545` 环境及其地址见 [HISTORY](HISTORY.md)，只对仍持有那组数据的人有效。新银行不会自动迁移旧银行中的 6 枚存款。

下面从第 1 节开始建立一组独立环境。若配置文件已存在，优先恢复该轮；要重新开始就换整个运行目录与数据库，不覆盖原文件。

## 1. 先确认环境与端口

需要 Node.js 24+、pnpm、npm、Foundry、PostgreSQL 与 jq。检查并安装本项目依赖：

```bash
cd tokenbank-fullstack-13
node --version
pnpm --version
forge --version
anvil --version
cast --version
jq --version
pg_isready -h 127.0.0.1 -p 5432
npm --prefix backend ci
pnpm --dir frontend install --frozen-lockfile
```

PostgreSQL 应能接受连接；如果缺工具，先按其安装方式准备，不要继续运行后面的半套流程。使用以下本地地址：

```text
RPC：http://127.0.0.1:18546，chain ID 31337
后端：http://127.0.0.1:13002
页面：http://127.0.0.1:3181
```

```bash
lsof -nP -iTCP:18546 -iTCP:13002 -iTCP:3181 -sTCP:LISTEN
```

无输出表示没有发现监听者，退出码 1 在这种情况下正常。有占用则选择空闲端口并同步所有配置，不停止未知进程。

## 2. 终端 A：创建本轮配置，启动本地链

在项目目录执行。这里只在文件不存在时创建，不读取或覆盖现有 `.env`：

```bash
mkdir -p ../output-tdd/tokenbank-walkthrough
if [ ! -e ../output-tdd/tokenbank-walkthrough/session.env ]; then
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
NEXT_PUBLIC_EXPLORER_URL=
PUBLIC_ORIGIN=http://127.0.0.1:3181
INDEXER_URL=http://127.0.0.1:13002
EOF_CONFIG
fi
anvil --host 127.0.0.1 --port 18546 --chain-id 31337 --silent \
  --state ../output-tdd/tokenbank-walkthrough/anvil-state.json --state-interval 10
```

保持 A 运行。静默模式不打印测试密钥；状态文件存在时加载，正常退出时保存。不要让另一条链同时使用这个文件。临时目录应被本机 `.git/info/exclude` 忽略，首次克隆时先检查。

## 3. 终端 B：部署 Token 和 TokenBank

当前 `contracts/` 没有独立的 Forge 部署脚本。自动学习可先跑 README 的集成测试；若要留下供网页使用的实例，本节通过 Remix 连接**本地 Anvil**部署，不复用测试结束后已销毁的地址。

1. 在 Remix 导入 `contracts/src/BaseERC20.sol` 和 `IdempotentTokenBank.sol`。编译器 `0.8.24`、EVM `shanghai`，对照本项目 `contracts/foundry.toml`。
2. Deploy & Run 选择可连接外部 HTTP 节点的环境，填 `http://127.0.0.1:18546`，确认 chain ID 31337。**不要选 Remix VM**，否则部署会进入另一条模拟链。
3. 使用 Anvil 提供的第一个解锁测试账户，Value 0，先部署 BaseERC20，再把其地址传给 IdempotentTokenBank 构造函数。
4. 保存两个新地址和 Token 部署回执的区块号。若界面不支持外部节点，停在这里排查连接，不把 Remix VM 地址填入后续配置。

终端 B 从仓库根目录进入项目并加载配置：

```bash
cd tokenbank-fullstack-13
set -a
source ../output-tdd/tokenbank-walkthrough/session.env
set +a
cast chain-id --rpc-url "$RPC_URL"
cast rpc eth_accounts --rpc-url "$RPC_URL"
```

在 `session.env` 中补上以下公开值。地址来自本轮部署，`START_BLOCK` 是 Token 部署区块的十进制数：

```dotenv
TOKENBANK_DEPLOYER=<部署Token的Anvil公开地址>
TOKEN_ADDRESS=<本轮BaseERC20地址>
BANK_ADDRESS=<本轮IdempotentTokenBank地址>
NEXT_PUBLIC_BANK_ADDRESS=<与BANK_ADDRESS相同>
START_BLOCK=<Token部署区块十进制数>
```

以上是占位格式，**替换后才 source**，不要把尖括号文本直接执行。重新加载并核验：

```bash
set -a
source ../output-tdd/tokenbank-walkthrough/session.env
set +a
cast code "$BANK_ADDRESS" --rpc-url "$RPC_URL"
cast call "$BANK_ADDRESS" 'token()(address)' --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'decimals()(uint8)' --rpc-url "$RPC_URL"
```

代码须非空，token 必须等于本轮 Token 地址，精度 18。Token 初始一亿枚给部署者，银行初始资产为 0。

## 4. 终端 B + 浏览器：准备自己的测试钱包

在浏览器钱包添加本地网络：RPC `http://127.0.0.1:18546`，chain ID `31337`，原生币符号 ETH。使用自己的现有测试账户即可，不必把 Anvil 测试私钥导入钱包。

把该账户的公开地址填入变量，先校验。选尚未收到本轮 Token 的账户，便于核对 100 枚起点：

```bash
WALLET_ADDRESS='<浏览器当前钱包的完整公开地址>'
cast to-check-sum-address "$WALLET_ADDRESS"
cast rpc anvil_setBalance "$WALLET_ADDRESS" 0x8ac7230489e80000 --rpc-url "$RPC_URL"
cast send "$TOKEN_ADDRESS" 'transfer(address,uint256)' "$WALLET_ADDRESS" 100000000000000000000 \
  --rpc-url "$RPC_URL" --from "$TOKENBANK_DEPLOYER" --unlocked
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$WALLET_ADDRESS" --rpc-url "$RPC_URL"
```

第一条写入把本地 ETH **设为** 10；Token transfer 则每执行一次**追加** 100 枚，不能重复当作初始化。最后应返回 100 枚的最小单位数。在钱包添加自定义代币时填 Token 地址，不填银行地址。

## 5. 终端 C：创建独立数据库并启动索引器

```bash
cd tokenbank-fullstack-13
set -a
source ../output-tdd/tokenbank-walkthrough/session.env
set +a
```

仅首次数据库不存在时执行：

```bash
createdb "$PGDATABASE"
```

然后启动后端：

```bash
npm --prefix backend start
```

程序核对网络、Token、银行，再建表和扫描。默认连接身份由本机 PostgreSQL 配置决定；认证错误时修复本地连接，不把密码写入公开 session 文件。

Anvil 默认按交易出块，故这里 `CONFIRMATIONS=0` 便于观察。它只适用于这次本地练习，不应直接搬到公共链环境。

## 6. 终端 D：启动页面并连接钱包

```bash
cd tokenbank-fullstack-13
set -a
source ../output-tdd/tokenbank-walkthrough/session.env
set +a
pnpm --dir frontend dev --port 3181
```

打开 `http://127.0.0.1:3181`，连接第 4 节的钱包。银行设置填本轮银行地址。页面应显示钱包 100 BERC20、个人存款 0、银行资产 0。

Next.js 同源代理把 HTTP 请求转给 13002 后端；浏览器不直接访问数据库。首次操作需 SIWE 登录签名，域名、端口与 `PUBLIC_ORIGIN` 必须完全一致。

## 7. 页面操作：存款、取款与余额验收

输入 10，存入。额度不足时钱包先弹授权，再弹存款；每次核对网络、合约和金额。授权成功后余额还没变，存款成功并经后端核实后应看到钱包 90、个人 10、银行 10。

切换取出，输入 4，成功后应为 94、6、6。尝试取 7 应被拒绝，不能动用别人存入的资产。

历史列表中存款表现为转出到银行、提款表现为从银行转入；approve 只有 Approval，不出现在只索引 Transfer 的列表。列表可能晚于余额更新。

在 B 终端只读核对：

```bash
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$WALLET_ADDRESS" --rpc-url "$RPC_URL"
cast call "$BANK_ADDRESS" 'balances(address)(uint256)' "$WALLET_ADDRESS" --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BANK_ADDRESS" --rpc-url "$RPC_URL"
curl --fail --silent --show-error "http://127.0.0.1:13002/transfers?address=$WALLET_ADDRESS&limit=10&offset=0"
psql "$PGDATABASE" -v ON_ERROR_STOP=1 -f database/verify.sql
```

### 7.5 切换账户，验证同一家银行

换另一个没存钱的账户，个人存款应为 0，银行资产仍为 6。切回来才重新看到个人 6。这验证账户隔离，不能用总资产作为自己的取款额度。

## 8. 复现此前测试中的异常与分页

先试零金额、超精度、超额提款，确认不产生交易。再在钱包拒签，观察页面恢复且余额不变。切网络或账户后应阻止旧操作继续。

若已经广播后超时，先“核实结果”，需要继续时复用原 operationId。点击终止只能停止等待，钱包晚返回的哈希仍需保存，不能用新编号重新扣一次。

历史每页返回多少由 limit 控制，offset 跳过前面的记录。数据少时看不到下一页是正常的，不必为了截图反复交易。

## 9. 自动检查、生产预览与停止

检查命令集中在 [项目规则](AGENTS.md#验证与交付)；只学习时先运行 README 的最短测试，不必每读一节重跑全套。

正常结束时在各自终端按 Ctrl+C，先停止页面和后端，再停止自己启动的 Anvil。保留链状态、session.env 与数据库；只有地址文件无法恢复余额。

生产预览先停止同目录开发服务，再在 D 的同一配置环境中执行：

```bash
pnpm --dir frontend build
pnpm --dir frontend start --port 3181
```

修改 `NEXT_PUBLIC_` 后需要重新构建。不要让 dev、build、start 同时使用同一个 `.next`。

## 10. 切换到 Sepolia / Base

本地地址、测试余额和解锁账户不可直接搬到公共链。需要单独部署、准备本人钱包、核对网络和费用，且索引配置与页面必须一起更新。本篇没有执行这条路径；签名版本的已有公共测试网参考在 [16 的部署资料](../eip712-permit-16/DEPLOYMENT.md)。

## 11. 按现象排查

- 余额为零：先查 RPC、Token、钱包是否同一轮，不先重复充值。
- 银行没有代码：很可能链状态丢失或用了另一条链的地址。
- 登录失败：核对来源 URL；localhost 与 127.0.0.1 不等价。
- 交易成功、历史为空：核对 START_BLOCK、Token 和索引进度。
- 端口被占：辨认已有服务，换整组配置或复用自己的原环境。

本次文档重构未重新运行页面、数据库、Remix 或链上步骤。历史证据见 [HISTORY](HISTORY.md)，新流程的数字是供你逐项核对的预期。

# Permit2：复用银行、签名存款与完整本地流程

在第 16 题原银行和前端中增加 `depositWithPermit2()`，普通存款、EIP-2612 Permit、提款、NFT、登录、账本、索引和恢复继续使用原实现。无需另建一套 TokenBank。

## 原理与交易次数

- 普通授权：Token 的 `approve(bank, amount)` → `bank.deposit()`；银行额度不足时两笔交易。
- EIP-2612：Token 本身实现 `permit()`。离线签名 → `bank.permitDeposit()`，授权和转账在一笔交易中完成。
- Permit2：普通 ERC20 也能使用。先由 Token 持有人执行 `approve(permit2, allowance)`；之后离线签署 `PermitTransferFrom`，银行调用 Permit2 转账并记账。已有足够额度时只需一笔存款交易；首次无额度时仍需两笔。

**本页面仅在额度不足时授权本次金额，不自动授予无限额度。** 本次额度用完后，下次仍需 approve；若此前已有足够额度，则直接签名存款。SIWE 登录签名、Permit2 签名均不发送交易；最终存款需要模拟 ETH 支付 Gas。

使用官方完整 [Uniswap Permit2](contracts/lib/permit2/README.md) 的 **SignatureTransfer**，不使用 AllowanceTransfer 的持久银行额度。本地真实部署，不假定公共链固定地址在 Anvil 上存在。官方源码固定在 `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219`，其 Solidity 0.8.17 单独编译；业务合约仍为 0.8.24。

签名域为 `name = Permit2`、`chainId`、`verifyingContract = 本轮 Permit2 地址`，**没有 version 字段**。签名绑定 Token、金额、spender（银行）、nonce 和 deadline。这里 `nonce = uint256(operationId)`，复用已有随机 32 字节操作编号，不另建 nonce 存储。官方 Permit2 使用无序 nonce 位图，不是逐次加一。

银行固定 `owner = msg.sender`、`to = address(this)`；外部不能指定付款人、收款人或另一 Token。验证和转账失败时，nonce、操作标记和账本一起回滚；相同用户、编号、金额的已完成操作直接返回，不再次转账。三种存款共享账本和 `OperationExecuted` 事件。

```solidity
constructor(address tokenAddress, address permit2Address)
depositWithPermit2(uint256 amount, bytes32 operationId, uint256 deadline, bytes signature)
```

零 Permit2 地址只用于禁用该功能的兼容部署。新部署脚本自动部署真实 Permit2 并传入地址。旧银行不能原地升级：新前端会将旧银行的 Permit2 选项禁用，已有余额继续在旧银行查询/提取。

参考：[官方总览](https://developers.uniswap.org/docs/protocols/permit2/overview)、[SignatureTransfer](https://developers.uniswap.org/docs/protocols/permit2/concepts/signature-transfer)、[课程参考分支](https://github.com/lbc-team/TokenBank/tree/tokenbank-permit2)。已读取参考分支银行源码，保留本仓库的 operationId、调用者约束和恢复机制。

## 先运行自动验证

所有命令从本项目目录执行。安装使用原有包管理器及锁文件；首次编译需要下载 Solidity 0.8.17。后端集成需要本机 PostgreSQL，使用随机临时 schema，不改已有业务库。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
pnpm --dir frontend install --frozen-lockfile
npm --prefix backend ci
forge build --root contracts/lib/permit2
forge test --root contracts -vvv
pnpm --dir frontend test:permit2
PGHOST=127.0.0.1 PGDATABASE=postgres TEST_PERMIT2=1 npm --prefix backend run test:integration
```

合约测试使用没有 EIP-2612 的 `BaseERC20`，覆盖成功转账、篡改/跨账户/跨银行/跨链、过期、缺额度、余额不足、幂等及随机 nonce 位图。RPC 测试实际调用页面的银行客户端，检查首次两笔/已有额度一笔、拒签/切换/取消后停止、重复恢复不转账，并回归 NFT 购买。全栈测试使用普通 ERC20，执行页面实际 `executeIntent`，验证 SIWE → 后端登记 → Permit2 存款 → 原编号恢复 → 提款 → 索引 → 同源 API；同时核实回滚交易状态。

保存可提交作业的本地转移日志：

```bash
mkdir -p ../output-tdd/permit2
set -o pipefail
forge test --root contracts --match-test testPermit2DepositTransfersOrdinaryERC20 -vvvv 2>&1 | tee ../output-tdd/permit2/transfers.log
pnpm --dir frontend test:permit2 2>&1 | tee ../output-tdd/permit2/client-green.log
PGHOST=127.0.0.1 PGDATABASE=postgres TEST_PERMIT2=1 npm --prefix backend run test:integration 2>&1 | tee ../output-tdd/permit2/backend-checks.log
```

## 全新手工环境：先部署 Permit2

原来的 `8547 / 13016 / 3016` 环境可以保留。本示例使用 `8548 / 13018 / 3018`、独立运行目录和数据库。不要把同为 31337 的两条 Anvil 链混用。不要复制已有 `.env`、密钥或链状态。

终端 A：先检查端口；发现占用时先核对该服务，不重复启动。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
lsof -nP -iTCP:8548 -iTCP:13018 -iTCP:3018 -sTCP:LISTEN
export PRACTICE_RUN="$(git rev-parse --show-toplevel)/output-tdd/permit2/demo"
mkdir -p "$PRACTICE_RUN"
anvil --host 127.0.0.1 --port 8548 --chain-id 31337 --silent \
  --state "$PRACTICE_RUN/anvil-state.json" --state-interval 10 --preserve-historical-states
```

终端 B：只在首次部署。脚本依次部署 JUL、官方 Permit2、银行、NFT 和市场，并给第二个模拟账户 1000 JUL。JSON 文件存在时跳过，防止重复部署；中断或 JSON 不完整时先查交易，不删文件盲目重试。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
export PRACTICE_RUN="$(git rev-parse --show-toplevel)/output-tdd/permit2/demo"
if [ ! -e "$PRACTICE_RUN/deployment.json" ]; then
  node frontend/scripts/permit-setup.mts http://127.0.0.1:8548 > "$PRACTICE_RUN/deployment.json"
fi
jq . "$PRACTICE_RUN/deployment.json"
if [ ! -e "$PRACTICE_RUN/session.env" ]; then
  jq -er --arg run "$PRACTICE_RUN" '
    "PRACTICE_RUN=" + ($run | @sh),
    "RPC_URL=" + .rpc,
    "CHAIN_ID=" + (.chainId | tostring),
    "TOKEN_ADDRESS=" + .token,
    "BANK_ADDRESS=" + .bank,
    "PERMIT2_ADDRESS=" + .permit2,
    "SELLER=" + .seller,
    "BUYER=" + .buyer,
    "NEXT_PUBLIC_BANK_ADDRESS=" + .bank,
    "NEXT_PUBLIC_CHAIN_ID=" + (.chainId | tostring),
    "NEXT_PUBLIC_LOCAL_RPC_URL=" + .rpc
  ' "$PRACTICE_RUN/deployment.json" > "$PRACTICE_RUN/session.env"
  cat >> "$PRACTICE_RUN/session.env" <<'ENV'
# 页面钱包公开地址；不填写私钥。
PRACTICE_WALLET=
NEXT_PUBLIC_EXPLORER_URL=
INDEXER_URL=http://127.0.0.1:13018
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=tokenbank_permit2_16
HOST=127.0.0.1
PORT=13018
FRONTEND_PORT=3018
PUBLIC_ORIGIN=http://127.0.0.1:3018
START_BLOCK=0
CONFIRMATIONS=0
BATCH_SIZE=100
POLL_INTERVAL_MS=1000
ENV
fi
set -a
source "$PRACTICE_RUN/session.env"
set +a
cast chain-id --rpc-url "$RPC_URL"
cast call "$BANK_ADDRESS" 'token()(address)' --rpc-url "$RPC_URL"
cast call "$BANK_ADDRESS" 'permit2()(address)' --rpc-url "$RPC_URL"
cast code "$PERMIT2_ADDRESS" --rpc-url "$RPC_URL"
```

核对 chain ID 为 31337，银行 Token / Permit2 与 JSON 一致，Permit2 code 不为 `0x`。本地地址以本轮输出为准，不硬编码历史地址。

## 前端操作

终端 C：以下 `createdb` 只在首次执行。恢复时沿用同一数据库，不清空原库。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
set -a
source ../output-tdd/permit2/demo/session.env
set +a
env -u DATABASE_URL -u PGOPTIONS createdb "$PGDATABASE"
env -u DATABASE_URL -u PGOPTIONS node backend/src/main.ts
```

终端 D：若本目录已有 Next 服务，先在其原终端用 Ctrl+C 停止，再启动本轮页面。不要在同一目录同时启动两个 Next 服务或构建。

```bash
cd /Users/julian/Documents/Codex/2026-09-03/block-chain-list/eip712-permit-16
set -a
source ../output-tdd/permit2/demo/session.env
set +a
pnpm --dir frontend dev --port "$FRONTEND_PORT"
```

钱包配置 RPC `http://127.0.0.1:8548`、chain ID 31337、符号 ETH，打开 [本轮页面](http://127.0.0.1:3018)。使用自己的隔离测试钱包，将公开地址填入本轮 `session.env` 的 `PRACTICE_WALLET`。不要导入 Anvil 私钥。

终端 B 重新加载配置，首次为该公开地址提供模拟 ETH 和 JUL；转 JUL 每执行一次都会再次充值。

```bash
set -a
source "$PRACTICE_RUN/session.env"
set +a
cast rpc anvil_setBalance "${PRACTICE_WALLET:?请填写钱包公开地址}" 0xDE0B6B3A7640000 --rpc-url "$RPC_URL"
cast send "$TOKEN_ADDRESS" 'transfer(address,uint256)' "${PRACTICE_WALLET:?请填写钱包公开地址}" 1000000000000000000000 \
  --unlocked --from "$SELLER" --rpc-url "$RPC_URL"
```

1. 连接钱包，确认页面银行是本轮 `BANK_ADDRESS`。
2. 选择 **Permit2**，输入 `10`，点击“签名并存入”。首次可能先要求 SIWE 登录签名。
3. 若 Permit2 额度不足，钱包先确认 `approve(Permit2, 10 JUL)`，等待上链。
4. 签署 Permit2 数据：Token、10 JUL、银行 spender、随机 nonce、20 分钟 deadline；再确认银行存款交易。
5. 成功后钱包减少 10 JUL，个人可提余额增加 10 JUL；索引追平后显示钱包到银行的转账。
6. 提款沿用“取出”。取消或刷新后用原操作核实/继续，不创建新编号重复存款。签名不保存，业务哈希先保存后处理取消。

## 无钱包扩展的 CLI 签名演示

仍在终端 B，使用 Anvil 解锁的 `BUYER` 模拟账户，不读取密钥。以下示例存 10 JUL；先给 Permit2 授权。CLI 直接调用合约，不经过页面 SIWE；银行事件和 Token 索引仍能核实。

```bash
export AMOUNT_WEI=10000000000000000000
cast send "$TOKEN_ADDRESS" 'approve(address,uint256)' "$PERMIT2_ADDRESS" "$AMOUNT_WEI" \
  --unlocked --from "$BUYER" --rpc-url "$RPC_URL"
export OPERATION_ID="$(cast keccak "$(uuidgen)")"
export PERMIT2_NONCE="$(cast to-dec "$OPERATION_ID")"
export PERMIT2_DEADLINE="$(( $(cast block latest --field timestamp --rpc-url "$RPC_URL") + 1200 ))"
export PERMIT2_DATA="$(jq -nc \
  --arg permit2 "$PERMIT2_ADDRESS" --arg token "$TOKEN_ADDRESS" --arg bank "$BANK_ADDRESS" \
  --arg amount "$AMOUNT_WEI" --arg nonce "$PERMIT2_NONCE" --arg deadline "$PERMIT2_DEADLINE" \
  --argjson chainId "$CHAIN_ID" '
  {
    domain:{name:"Permit2",chainId:$chainId,verifyingContract:$permit2},
    primaryType:"PermitTransferFrom",
    types:{
      EIP712Domain:[{name:"name",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],
      TokenPermissions:[{name:"token",type:"address"},{name:"amount",type:"uint256"}],
      PermitTransferFrom:[{name:"permitted",type:"TokenPermissions"},{name:"spender",type:"address"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}]
    },
    message:{permitted:{token:$token,amount:$amount},spender:$bank,nonce:$nonce,deadline:$deadline}
  }')"
export PERMIT2_SIGNATURE="$(cast rpc eth_signTypedData_v4 "$BUYER" "$PERMIT2_DATA" --rpc-url "$RPC_URL" | jq -er .)"
cast call "$BANK_ADDRESS" 'depositWithPermit2(uint256,bytes32,uint256,bytes)' \
  "$AMOUNT_WEI" "$OPERATION_ID" "$PERMIT2_DEADLINE" "$PERMIT2_SIGNATURE" \
  --from "$BUYER" --rpc-url "$RPC_URL"
cast send "$BANK_ADDRESS" 'depositWithPermit2(uint256,bytes32,uint256,bytes)' \
  "$AMOUNT_WEI" "$OPERATION_ID" "$PERMIT2_DEADLINE" "$PERMIT2_SIGNATURE" \
  --unlocked --from "$BUYER" --rpc-url "$RPC_URL" --json | tee "$PRACTICE_RUN/permit2-deposit.json"
export PRACTICE_TX_HASH="$(jq -er .transactionHash "$PRACTICE_RUN/permit2-deposit.json")"
cast receipt "$PRACTICE_TX_HASH" --rpc-url "$RPC_URL" --json
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BUYER" --rpc-url "$RPC_URL"
cast call "$TOKEN_ADDRESS" 'balanceOf(address)(uint256)' "$BANK_ADDRESS" --rpc-url "$RPC_URL"
cast call "$BANK_ADDRESS" 'balances(address)(uint256)' "$BUYER" --rpc-url "$RPC_URL"
```

`cast call` 仅模拟，不消费 nonce；只有 `cast send` 执行交易。独立初始 BUYER 为 1000 JUL 时，存款后为 990 JUL，银行和个人可提余额为 10 JUL。再次执行同编号只会幂等返回；真正下一笔存款需要新的编号和签名，并先检查 Permit2 allowance。

恢复时重新启动终端 A，加载同一 state 文件，其余终端加载同一 `session.env`，跳过部署、充值和建库。保留同一 Token、银行、Permit2、数据库。只恢复地址文件不能恢复链上资产。

## 本次实测记录

2026-09-23，本地 EVM / Anvil、Node 24、PostgreSQL：26 项合约测试（两项 fuzz 各 256 次）、前端 12 项单元测试与普通/Permit/Permit2 三种 RPC 集成、后端 4 项测试与三种授权模式的全栈集成全部通过。前后端 lint、格式、类型检查通过；[生产构建](../output-tdd/permit2/build.log) 在隔离副本完成，浏览器验证了三种授权选项、存取切换，控制台无错误；未在真实钱包扩展中点击签名。

[共享 pre-commit](../output-tdd/permit2/hook.log) 在相同源码/依赖的临时 Git 仓库实跑通过，包含官方 Permit2 的独立编译。测试副本先用 `next typegen` 生成共享聊天前端所需路由类型；没有改变真实暂存区或提交业务代码。


- [Foundry 日志](../output-tdd/permit2/forge.log)：普通 ERC20 钱包 `1000 → 900`，银行/可提余额 `0 → 100`；[完整 Transfer 轨迹](../output-tdd/permit2/transfers.log) 能看到银行 → Permit2 → Token 调用及 `Transfer(user, bank, amount)`。
- [RPC 日志](../output-tdd/permit2/client-green.log)：首次 2 笔交易；测试预授权后 1 笔交易。记录实际存款哈希、Token 地址、钱包前后余额，并回归 NFT 转移。
- [全栈日志](../output-tdd/permit2/backend-checks.log)：实际 `executeIntent` 存入 `2.000000000000000001` Token、恢复、提款、索引及失败回执核实成功。

[CLI 实测日志](../output-tdd/permit2/cli-demo.log) 直接执行本文部署与签名命令，BUYER `1000 → 990 JUL`，银行/可提余额为 `10 JUL`；重启加载同一链状态后，[存款余额](../output-tdd/permit2/restored-balance.log) 和[原成功回执](../output-tdd/permit2/restored-receipt.json) 仍可读取。本轮模拟状态保留在 `output-tdd/permit2/demo/`，未创建持久业务数据库；后端集成的临时 schema 已清理。恢复时跳过首次部署和 CLI 存款，按上文首次建库即可接入页面。

日志在本地忽略目录，克隆后按上方命令重建。本轮自动化使用真实本地链和数据库，钱包适配器只补账户选择/拒签等交互；不等同于真实钱包扩展人工签名，也未执行公共链交易。支持无手续费、无 rebase Token；前端按 EOA 钱包验证，未增加智能合约钱包 UI。

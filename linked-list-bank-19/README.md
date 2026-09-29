# Solidity 链表 Bank：累计存款前 10 名

题目来源：本次「用 Solidity 实现一个链表」第 1 题。实现钱包直接向 Bank 地址存入 ETH、记录每个地址的累计金额，并用可迭代链表保存前 10 名。

题面提到之前的 TokenBank 前三名；仓库中对应实现实际是 [ETH Bank](../bank-05/contracts/Bank.sol)，所以本题按直接转 ETH 的要求实现，不涉及 ERC20 的 approve / transferFrom。旧项目保持原样，新练习独立放在本目录。

## 实现范围与阅读顺序

1. [项目规则](AGENTS.md)。
2. [src/Bank.sol](src/Bank.sol)：两个存款入口、单链表维护、查询和管理员提款。
3. [test/Bank.t.sol](test/Bank.t.sol)：存款、排名边界、提款失败及随机序列测试。
4. [script/DeployBank.s.sol](script/DeployBank.s.sol)：用 `forge script` 模拟或部署。
5. [foundry.toml](foundry.toml)：Solidity `0.8.24`、Shanghai、优化器 200 次。

前三项题面功能均在一个合约内完成。实现选择：沿用旧 Bank 的管理员统一提款功能；按**历史累计存款**排名，提款不会降低累计值或清空榜单。普通用户没有个人提款接口，`deposits` 不是个人可提余额。

## 链表如何保存和更新前 10 名

```text
deposits[地址] = 累计存款金额（Wei）
next[地址]     = 下一位用户的地址
size           = 当前榜单人数，0～10

next[0] → Alice(8 ETH) → Bob(5 ETH) → Carol(2 ETH) → 0
           第一名          第二名        尾节点
```

`address(0)` 是哨兵和结束标记，不是用户。`mapping` 本身不可枚举；从 `next(address(0))` 开始反复查询 `next(当前地址)`，便能按名次迭代，遇到零地址结束。

一笔存款的调用顺序：

```text
钱包直接转 ETH → receive() ─┐
显式调用 deposit() ────────┴→ _deposit() → _updateTop10(存款人)
```

更新时先校验金额大于零，再增加 `deposits[msg.sender]`，最后执行：

1. 查找并摘下该用户原来的节点，避免重复节点或成环。
2. 从头寻找插入位置，跳过金额大于或等于该用户的节点；同额已有成员保持在前。
3. 如果已有 10 人的金额不低于该用户，就不入榜；否则连接前驱、新节点和后继。
4. 插入后若有 11 人，断开第 10 名之后的节点并清理淘汰者的链接。其累计存款保留，后续追加存款仍能再次入榜。

每笔存款只处理最多 10 个已有节点，时间复杂度 `O(10)`，不随总存款人数增加。只有当前存款人的金额增加，因此不必为榜外所有人维护链表。持久化排行榜使用 `next` 映射；`getTop10()` 返回的数组只是沿链表生成的内存查询结果。

主要接口：

```solidity
receive() external payable;
function deposit() external payable;
function deposits(address user) external view returns (uint256);
function next(address user) external view returns (address);
function size() external view returns (uint256);
function getTop10() external view returns (address[] memory accounts, uint256[] memory amounts);
function admin() external view returns (address);
function withdraw() external;
```

`getTop10()` 返回实际人数，空榜返回空数组。榜外地址的 `next` 为零，尾节点也一样；判断成员身份需从哨兵遍历，不能只检查某地址的 `next` 是否为零。所有金额均以 Wei 保存，`1 ETH = 10^18 Wei`。

## 安装与测试

预先安装 Foundry（包含 `forge`、`cast`、`anvil`）和 `jq`。本项目不依赖第三方合约库，无需 `forge install`、npm 或环境文件；首次编译时 Foundry 按配置取得 Solidity `0.8.24` 编译器。

从**仓库根目录**进入项目，执行：

```bash
cd linked-list-bank-19
forge --version
cast --version
anvil --version
jq --version
forge fmt --check
forge build
forge test -vv
```

测试覆盖空榜、两个存款入口、12 人乱序排名、同额不挤榜、淘汰后再入榜、榜内追加、零金额和未知调用拒绝、管理员权限、提款回滚和重入。随机测试每轮对 16 位用户执行 32 笔存款，每笔均对照独立的全用户排序结果，同时核对链表终止和所有用户累计金额。

## 完整本地部署与调用

以下交易仅在独立本地 Anvil 上执行，不使用真实钱包私钥。

### 1. 启动独立节点

在**项目目录**的终端 A 检查端口；无监听输出表示可用。有输出时先确认占用者，不停止不明进程。

```bash
lsof -nP -iTCP:18549 -sTCP:LISTEN
anvil --host 127.0.0.1 --port 18549 --chain-id 31337 --silent
```

`--silent` 避免把默认测试私钥打印出来。保持该终端运行；结束练习时用 `Ctrl+C` 停止自行启动的节点。重启不保存状态的 Anvil 后，旧地址和余额不再有效。

### 2. 取得公开测试账户，先模拟再部署

另开终端 B，从**仓库根目录**进入本项目。下面变量只包含本地 RPC 和公开地址：

```bash
cd linked-list-bank-19
export BANK_RPC_URL="http://127.0.0.1:18549"
export BANK_ADMIN="$(cast rpc eth_accounts --rpc-url "$BANK_RPC_URL" | jq -r '.[0]')"
export BANK_ALICE="$(cast rpc eth_accounts --rpc-url "$BANK_RPC_URL" | jq -r '.[1]')"
export BANK_BOB="$(cast rpc eth_accounts --rpc-url "$BANK_RPC_URL" | jq -r '.[2]')"
test "$(cast chain-id --rpc-url "$BANK_RPC_URL")" = 31337
forge script script/DeployBank.s.sol:DeployBank \
  --rpc-url "$BANK_RPC_URL" --sender "$BANK_ADMIN" -vvvv
```

上一步只模拟；下一步才发送本地部署交易：

```bash
forge script script/DeployBank.s.sol:DeployBank \
  --rpc-url "$BANK_RPC_URL" --sender "$BANK_ADMIN" \
  --unlocked --broadcast -vvvv
export BANK_ADDRESS="$(jq -r '.transactions[] | select(.contractName == "Bank" and .transactionType == "CREATE") | .contractAddress' broadcast/DeployBank.s.sol/31337/run-latest.json)"
cast code "$BANK_ADDRESS" --rpc-url "$BANK_RPC_URL"
cast call "$BANK_ADDRESS" 'admin()(address)' --rpc-url "$BANK_RPC_URL"
cast call "$BANK_ADDRESS" 'size()(uint256)' --rpc-url "$BANK_RPC_URL"
```

预期：存在合约代码，`admin()` 等于 `BANK_ADMIN`，`size()` 为 `0`。本地广播记录、缓存和编译产物已忽略。

### 3. 存款、追加并核验链表

继续在**项目目录**的终端 B 执行。第一笔不提供函数签名，等价于钱包直接向 Bank 地址转 ETH：

```bash
cast send "$BANK_ADDRESS" --value 1ether \
  --from "$BANK_ALICE" --unlocked --rpc-url "$BANK_RPC_URL"
cast send "$BANK_ADDRESS" 'deposit()' --value 2ether \
  --from "$BANK_BOB" --unlocked --rpc-url "$BANK_RPC_URL"
cast send "$BANK_ADDRESS" 'deposit()' --value 2ether \
  --from "$BANK_ALICE" --unlocked --rpc-url "$BANK_RPC_URL"
cast call "$BANK_ADDRESS" 'getTop10()(address[],uint256[])' --rpc-url "$BANK_RPC_URL"
cast call "$BANK_ADDRESS" 'next(address)(address)' 0x0000000000000000000000000000000000000000 --rpc-url "$BANK_RPC_URL"
cast call "$BANK_ADDRESS" 'next(address)(address)' "$BANK_ALICE" --rpc-url "$BANK_RPC_URL"
cast call "$BANK_ADDRESS" 'next(address)(address)' "$BANK_BOB" --rpc-url "$BANK_RPC_URL"
cast call "$BANK_ADDRESS" 'deposits(address)(uint256)' "$BANK_ALICE" --rpc-url "$BANK_RPC_URL"
cast balance "$BANK_ADDRESS" --ether --rpc-url "$BANK_RPC_URL"
```

预期：链表 `0 → Alice → Bob → 0`，金额依次为 `3000000000000000000`、`2000000000000000000` Wei，合约余额 `5 ETH`。超过 10 人、同额和淘汰再入榜在 Forge 测试中验证。

### 4. 管理员提款并核验历史

继续在**项目目录**执行：

```bash
cast send "$BANK_ADDRESS" 'withdraw()' \
  --from "$BANK_ADMIN" --unlocked --rpc-url "$BANK_RPC_URL"
cast balance "$BANK_ADDRESS" --ether --rpc-url "$BANK_RPC_URL"
cast call "$BANK_ADDRESS" 'getTop10()(address[],uint256[])' --rpc-url "$BANK_RPC_URL"
cast call "$BANK_ADDRESS" 'deposits(address)(uint256)' "$BANK_ALICE" --rpc-url "$BANK_RPC_URL"
```

预期：实际余额归零，Alice / Bob 的累计金额和榜单保留。只有管理员能提取全部 ETH，非管理员调用回滚；管理员是合约且拒绝收款时，提款整体回滚，可重试。

## MetaMask / Remix 使用

`src/Bank.sol` 没有依赖，可直接复制到 Remix，以 Solidity `0.8.24`、Shanghai、优化器 200 次编译，并先在 Remix VM 演练。已有部署可以通过相同 ABI 加载，无需重新部署。

在 MetaMask 连接正确网络后，使用发送功能向 Bank 合约地址转入该网络原生 ETH，不附加调用数据，即触发 `receive()`。等待成功回执，再读取 `deposits(发送地址)`、`getTop10()` 和合约实际余额。钱包必须估算足够 Gas，不能把复杂记账调用限制为普通转账的 21,000 Gas；其他合约也不应使用仅提供 2,300 Gas 津贴的 `send` / `transfer` 存款。

没有实现 `fallback()`，未知调用数据会回滚。通过强制转入等未经过存款入口的 ETH 不计个人存款。当前练习只在本地 EVM 验证；公共链部署和钱包签名需要对具体操作另行授权。

## 本次实测记录

2026-09-29，Foundry `1.8.1`、Solidity `0.8.24`、本地 Anvil `31337`（端口 `18549`）：

- `forge fmt --check`、`forge build` 成功；9 项测试通过、0 失败，其中随机测试运行 256 轮，每轮 32 笔存款。
- `forge script` 模拟和本地广播成功，并核对部署回执、代码及管理员地址。
- 直接转账 1 ETH、显式存款 2 ETH、追加 2 ETH 后，查询和逐节点迭代均为 Alice（3 ETH）→ Bob（2 ETH）→ 零地址，Bank 余额为 5 ETH。
- 管理员提款成功，Bank 余额归零；管理员余额变化等于 5 ETH 减实际 Gas 费用，累计存款及链表保持不变。
- 文档相对链接、函数中文 NatSpec 和 Git 改动范围检查通过。原始日志在仓库忽略目录 `output-tdd/linked-list-bank-19/`；本次测试节点在核验后关闭。

构建成功不代表零 lint 提示：Foundry 的启发式检查仍提示默认零值局部变量、低级 ETH 调用、提款锁及测试断言/类型转换等；提款权限、回滚及重入行为已由测试实际核验。本次未操作 MetaMask 界面或公共链，钱包直接转账路径通过本地空调用数据交易验证。

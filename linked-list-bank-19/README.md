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

1. 从头寻找插入位置，跳过金额大于或等于该用户的节点；同额已有成员保持在前。若先遇到自己，名次不变，直接结束，不改链接和人数。
2. 若走到链尾仍没遇到自己，则是榜外用户。榜未满时追加到末尾，榜已满时不入榜。
3. 若找到可前插的位置，从该位置继续寻找原节点或尾节点。榜内用户只断开旧前驱后再插入，人数不变。
4. 榜外入榜时，未满才增加人数；已满直接淘汰尾节点。仅替换第 10 名时只改其前驱。尾节点和榜外用户的后继原本就是零，无需重复清零。

每笔存款最多扫描 10 个已有节点，各节点不重复遍历，时间复杂度 `O(10)`，不随总存款人数增加。淘汰只断开链接，累计存款保留。只有当前存款人的金额增加，因此不必为榜外所有人维护链表。持久化排行榜使用 `next` 映射；`getTop10()` 返回的数组只是沿链表生成的内存查询结果。

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

测试覆盖空榜、两个存款入口、12 人乱序排名、同额不挤榜、淘汰后再入榜、榜内追加、零金额和未知调用拒绝、管理员权限、提款回滚和重入。Gas 回归测试还断言头/中/尾用户排名不变时只写一个存款槽，并单独验证仅替换榜尾的链接。随机测试每轮对 16 位用户执行 32 笔存款，每笔均对照独立的全用户排序结果，同时核对链表终止和所有用户累计金额。

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

## 初版实测记录（历史）

2026-09-29，Foundry `1.8.1`、Solidity `0.8.24`、本地 Anvil `31337`（端口 `18549`）：

- `forge fmt --check`、`forge build` 成功；9 项测试通过、0 失败，其中随机测试运行 256 轮，每轮 32 笔存款。
- `forge script` 模拟和本地广播成功，并核对部署回执、代码及管理员地址。
- 直接转账 1 ETH、显式存款 2 ETH、追加 2 ETH 后，查询和逐节点迭代均为 Alice（3 ETH）→ Bob（2 ETH）→ 零地址，Bank 余额为 5 ETH。
- 管理员提款成功，Bank 余额归零；管理员余额变化等于 5 ETH 减实际 Gas 费用，累计存款及链表保持不变。
- 文档相对链接、函数中文 NatSpec 和 Git 改动范围检查通过。原始日志在仓库忽略目录 `output-tdd/linked-list-bank-19/`；本次测试节点在核验后关闭。

构建成功不代表零 lint 提示：Foundry 的启发式检查仍提示默认零值局部变量、低级 ETH 调用、提款锁及测试断言/类型转换等；提款权限、回滚及重入行为已由测试实际核验。本次未操作 MetaMask 界面或公共链，钱包直接转账路径通过本地空调用数据交易验证。

## Gas 优化与对比（2026-09-29）

原版参考提交：`cd454e89702566ebcca436245394f940af3e9089`。本次保留公开 ABI、存储布局、错误字符串、事件、排名规则和提款保护，集中减少存款路径的存储读写：

- 名次不变时只更新 `deposits`，省掉无效的摘链、插链及 `size` 减一再加一。
- 从插入位置继续向后找原节点或尾部，合并原来的多次遍历；已有节点的 `next` 直接覆盖，尾部零链接不重复清零。
- `size` 只在未满榜的新用户入榜时增加，榜内移动和满榜替换不写人数。
- 缓存本次累计金额，供排名比较与事件复用；查询时缓存人数，避免循环反复读存储。

实测条件：两份合约均通过同一部署脚本在独立 Anvil 上模拟、广播，Solidity `0.8.24`、优化器 `200`、Shanghai、chain ID `31337`。每个存款场景是独立交易，读取成功回执的 `gasUsed`，包含交易固有开销和退款后的净消耗；没有把整个测试函数的 Gas 当作一次存款的成本。

首次存款使用空榜；其余存款场景基于 10 位用户依次存入 `100、90、80、70、60、50、40、30、20、10 ETH` 的相同状态。每个场景通过快照恢复，并校验累计金额、完整榜单、逐节点链接、榜外零链接和实际余额。原版与优化版使用同样的调用账户、顺序和金额。

```text
场景                         优化前     优化后     节省
部署                        603239     618592    -2.55%
首次 deposit                 93125      90210     3.13%
首次钱包直接转账              92975      90060     3.14%
第一名追加 1 ETH              40007      30574    23.58%
第五名追加 1 ETH              62947      48778    22.51%
第十名追加 1 ETH              89072      71533    19.69%
第五名追加 41 ETH 升至第一     59043      53734     8.99%
第十名追加 51 ETH 升至第五     96942      86572    10.70%
榜外存 9 ETH，未入榜         105518      95295     9.69%
榜外存 10 ETH，同额未入榜    105518      95295     9.69%
榜外存 15 ETH，仅替换榜尾    116410      98531    15.36%
榜外存 55 ETH，插入中间      122006     110174     9.70%
榜外存 101 ETH，成为第一     106626      99089     7.07%
落榜第十名追加 6 ETH 回榜     99310      81431    18.00%
管理员提款                   41704      41704     0.00%
```

“落榜回榜”先由榜外用户存入 15 ETH 淘汰第十名，再单独测量原第十名追加 6 ETH 的交易。金额仅为模拟数据。部署增加 `15,353 Gas`（`2.55%`），换取后续存款更低的开销；例如两次第一名不换位的追加存款共节省 `18,866 Gas`，已超过这笔部署差额。表中结论限于所测场景和编译设置，不代表所有输入都节省相同比例。

本次验证：11 项测试全部通过，随机测试扩展至 `1,024` 轮（`32,768` 笔存款）；新增存储写入回归测试在原实现上失败、优化后通过。两版部署和表中场景均在本地执行，原始脚本、回执 Gas 摘要与日志保存在仓库忽略目录 `output-tdd/linked-list-bank-gas/`，测试节点已关闭。未执行公共链操作。

从**项目目录**复验行为与存储写入约束：

```bash
forge fmt --check
forge build
forge test -vv --fuzz-runs 1024
forge test --match-test testUnchangedRankOnlyWritesDeposit -vv
```

没有新增尾指针或双向链表，以免在其他存款路径增加持久化写入；没有通过改变错误 ABI、缩小金额类型或删除安全检查换取 Gas。旧部署的字节码不会随源码改变，应用优化需要部署新版本。


## 后续提示方案的评估与撤回（2026-09-29）

当前交付保留上面的第一轮优化，撤回第二轮尾缓存及可选链下提示方案。题目核心是钱包直接转账、累计记账和固定 10 人链表；普通钱包转账无法直接使用提示入口，当前也没有必须支持的高频提示调用流程。

无尾缓存的提示方案虽然在部分单笔交易中节省 Gas，但部署从 `618,592` 增至 `842,860`（多 `224,268`），普通存款多 `55 Gas`，直接转账多 `33 Gas`。完整实测“部署 + 十笔填榜 + 七笔榜尾追加”总量由 `2,072,318` 降为 `2,071,344`，仅省 `974 Gas`（约 `0.047%`）；六笔追加时仍更贵。该示例是特定调用序列的盈亏平衡点，不代表高频使用提示没有价值。

对本题而言，新增接口、前驱验证、链下调用和提示失效重试的复杂度不值得保留，因此恢复第一轮版本。以后若确有大量适合提示的调用，再按实际交易分布、部署及失败费用重新评估。第一轮已获得的减少遍历、无效链接写入和人数写入的收益继续保留。

对比数据与撤回前源码保存在本地忽略目录 `output-tdd/linked-list-bank-selective/`，不包含在交付源码中。本次撤回后重新执行格式、构建及测试；未重新广播合约，也未执行公共链操作。

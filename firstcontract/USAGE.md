# Counter 完整操作指南：Foundry、钱包、Remix 与作业提交

本文按当前项目说明从本地开发到作业提交的全部步骤。2026-09-06 已完成 Sepolia 转账、部署和 `add(5)`，材料已提交到 GitHub；实际交易、费用与截图见 [README](README.md)。

可以先复现本地部分。再次执行 Sepolia 部署、转账或 `add(x)` 会产生新的交易和 Gas；查看现有合约时无需重新部署。

以下路径对应本机目录。若在其他电脑克隆仓库，请把 `cd` 命令中的绝对路径替换为实际路径。

## 1. 理解工具的用途

- **Solidity**：编写智能合约的语言。
- **Foundry**：本地智能合约工具包。`forge` 负责编译、测试和部署，`cast` 负责查询及调用合约，`anvil` 提供本地测试链，`chisel` 用于交互式尝试 Solidity。
- **Remix**：浏览器中的合约开发环境，本次使用它部署到 Sepolia。
- **MetaMask**：保管钱包账户，确认并签署交易。
- **AppKit**：网页中的钱包连接组件，让用户选择钱包；最终仍由钱包签名。
- **Sepolia**：公共以太坊测试网。
- **Etherscan / Blockscout**：查询交易结果、合约地址和源码。

本次实际流程：

```text
编写 Counter.sol
    → Forge 编译和测试
    → Remix 编译
    → MetaMask 确认部署
    → Sepolia 执行
    → Remix 调用 add(5)
    → Cast 和区块浏览器核验
    → 保存截图并提交 GitHub
```

## 2. 进入合约目录，检查和安装 Foundry

打开终端，进入本项目：

```bash
cd "/Users/julian/Documents/Codex/2026-09-03/block-chain-list/firstcontract"

forge --version
cast --version
anvil --version
```

本次验证环境的 Foundry 版本为 `1.8.1`，已经安装，可以直接继续。

如果换一台尚未安装的 Mac，按 [Foundry 官方安装说明](https://getfoundry.sh/introduction/installation/)安装：

```bash
curl -L https://getfoundry.sh/install | bash
```

重新打开终端，再执行：

```bash
foundryup
```

`foundryup` 安装或更新 Foundry 工具。安装后重新执行版本检查命令，确认 `forge`、`cast` 和 `anvil` 可用。

当前项目已经准备好配置和测试，无需再次执行 `forge init`，也无需安装 npm 依赖。

## 3. 理解合约与配置文件

打开 [contracts/Counter.sol](contracts/Counter.sol)：

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Counter {
    uint256 public counter;

    function get() external view returns (uint256) {
        return counter;
    }

    function add(uint256 x) external {
        counter += x;
    }
}
```

`counter` 初始为 `0`。`get()` 读取数值，`add(x)` 累加数值。变量标记为 `public`，因此还会自动生成 `counter()` 读取方法。

```text
新部署：get() → 0
add(5)：get() → 5
add(3)：get() → 8
add(0)：get() → 8
```

通过普通读取调用执行 `get()` 不需要签名、不消耗链上 Gas。`add(x)` 改变状态，需要交易。`x` 是无符号整数，不接受负数；超过 `uint256` 上限时交易回退。

[foundry.toml](foundry.toml) 告诉 Foundry 如何处理本项目：

```toml
[profile.default]
src = "contracts"
test = "test"
out = "../output-tdd/firstcontract/out"
cache_path = "../output-tdd/firstcontract/cache"
libs = []
solc_version = "0.8.24"
evm_version = "shanghai"
optimizer = false
```

- `src`：合约源码目录。
- `test`：测试目录。
- `out`：编译产物目录，包含 ABI 和字节码。
- `cache_path`：编译缓存目录。
- `libs = []`：本项目不依赖第三方合约库。
- `solc_version`：固定使用 Solidity `0.8.24`。
- `evm_version`：EVM 目标版本为 `shanghai`。
- `optimizer = false`：关闭优化，与本次 Remix 编译设置一致。

`out` 和 `cache_path` 相对于合约项目目录解析，实际写入仓库的 `output-tdd/firstcontract/`。这些生成文件不属于 GitHub 作业材料。

## 4. 使用 Forge 格式化、编译和测试

本节命令在第 2 步进入的合约目录执行。

检查代码格式：

```bash
forge fmt --check
```

若提示格式问题，自动调整：

```bash
forge fmt
```

编译合约：

```bash
forge build
```

首次运行可能下载指定版本的 Solidity 编译器。再次运行时如果源码未改变，显示 `compilation skipped` 属于正常缓存行为。

执行测试：

```bash
forge test -vv
```

[test/Counter.t.sol](test/Counter.t.sol) 中的一项测试覆盖：

```text
初始值为 0
连续累加正确
加 0 不改变数值
counter() 与 get() 返回一致
整数溢出会回退
回退后状态保持不变
```

成功时会看到类似结果：

```text
[PASS] testCounter()
1 passed; 0 failed
```

查看每次合约调用及返回值：

```bash
forge test --match-test testCounter -vvvv
```

`forge test` 自带测试执行环境，不需要提前启动 Anvil，也不会向 Sepolia 发交易。

查看对外接口 ABI：

```bash
forge inspect Counter abi --json
```

查看部署字节码和链上运行字节码：

```bash
forge inspect Counter bytecode
forge inspect Counter deployedBytecode
```

ABI 描述函数和参数，供 Remix、前端或其他程序调用；字节码是 EVM 执行的内容。`bytecode` 用于部署，`deployedBytecode` 是部署后留在链上运行的代码。

## 5. 使用 Anvil 和 Cast 在本地完整练习

本节练习“部署 → 读取 → 写入 → 再读取”，不花费 Sepolia 测试币。以下流程已经在本地实际跑通，结果为 `get(): 0 → 5`。

### 5.1 终端一：启动本地链

```bash
anvil --host 127.0.0.1 --port 18545 --quiet
```

保持该终端运行。`--quiet` 隐藏启动日志，因此没有明显输出也正常。使用 `18545` 是为了避开常见的 `8545` 端口；如果该端口也被占用，需要换一个空闲端口，并同步修改下面的 RPC 地址。

### 5.2 终端二：配置本地 RPC 和测试账户

```bash
cd "/Users/julian/Documents/Codex/2026-09-03/block-chain-list/firstcontract"

export COUNTER_LOCAL_RPC="http://127.0.0.1:18545"
export COUNTER_LOCAL_SENDER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

cast chain-id --rpc-url "$COUNTER_LOCAL_RPC"
```

应返回本地 Anvil 的 Chain ID：

```text
31337
```

`COUNTER_LOCAL_SENDER` 是默认 Anvil 预置的测试账户公开地址。

### 5.3 用 Forge 部署到本地链

```bash
forge create contracts/Counter.sol:Counter \
  --rpc-url "$COUNTER_LOCAL_RPC" \
  --from "$COUNTER_LOCAL_SENDER" \
  --unlocked \
  --broadcast
```

`--broadcast` 表示实际发送到指定链，此处是本地 Anvil。`--unlocked` 使用本地节点预置的已解锁测试账户，无需输入私钥；本例的这个参数仅用于本地链。

从输出找到 `Deployed to`。在全新默认 Anvil 上首次部署，本次得到下面的地址。如果你的输出不同，必须替换成实际地址：

```bash
export COUNTER_LOCAL_ADDRESS="0x5FbDB2315678afecb367f032d93F642f64180aa3"
```

### 5.4 读取初始值

```bash
cast call "$COUNTER_LOCAL_ADDRESS" \
  "get()(uint256)" \
  --rpc-url "$COUNTER_LOCAL_RPC"
```

预期返回 `0`。`get()(uint256)` 表示调用无参数的 `get()`，并按 `uint256` 解码返回值。

### 5.5 发送 add(5)

```bash
cast send "$COUNTER_LOCAL_ADDRESS" \
  "add(uint256)" 5 \
  --rpc-url "$COUNTER_LOCAL_RPC" \
  --from "$COUNTER_LOCAL_SENDER" \
  --unlocked
```

等待回执成功后，再次读取：

```bash
cast call "$COUNTER_LOCAL_ADDRESS" \
  "get()(uint256)" \
  --rpc-url "$COUNTER_LOCAL_RPC"
```

预期返回 `5`。

```text
cast call：读取或模拟，不保存状态变化
cast send：发送交易，成功后保存状态变化
```

### 5.6 停止本地链

回到终端一，按 `Ctrl+C`。上述启动方式没有保存状态，下次启动是一条新的本地链。Anvil 中的地址、余额和交易 Hash 不能当作 Sepolia 作业证据。

## 6. 准备 MetaMask 和 Sepolia 测试币

已有钱包可以直接使用。新设备从 [MetaMask 官方安装说明](https://support.metamask.io/start/getting-started-with-metamask/)进入官方扩展商店，安装后自行完成钱包创建或恢复。

在钱包网络列表中打开“显示测试网络”，选择 Sepolia；具体入口见 [MetaMask 测试网络说明](https://support.metamask.io/configure/networks/how-to-view-testnets-in-metamask/)。

本次账户信息如下。自行复现时，钱包地址应使用你自己的测试账户：

```text
网络：Sepolia
Chain ID：11155111
本次钱包地址：0x000071424bb08b910f0786e04D964A63D64bF1Ba
```

余额不足时，从 [Ethereum 官方 Sepolia 水龙头列表](https://ethereum.org/developers/docs/networks/#sepolia)选择一个水龙头，填写公开地址，按站点要求领取测试 ETH。领取条件可能变化，以站点显示为准。

本次使用钱包已有余额，没有重复领币。助记词、私钥和钱包密码不填写到项目、GitHub 或作业截图中。

## 7. 完成一次 Sepolia 转账

直接在 MetaMask 操作：

```text
选择 Sepolia
→ 点击“发送”
→ 填写收款地址
→ 输入 0.00001 Sepolia ETH
→ 核对网络、收款地址、金额和 Gas
→ 确认
→ 等待成功
→ 打开区块浏览器并保存交易 Hash
```

若使用已经集成 AppKit 的页面，先点击连接钱包、选择 MetaMask，再填写页面中的转账表单；签名仍在 MetaMask 中完成。本次复用了已有钱包页面，本目录本身不包含 AppKit 前端，也不需要启动前端服务来使用 Foundry 或 Remix。

本次按用户授权向自身转账，发送方和接收方相同，因此主要减少的是 Gas：

```text
转账金额：0.00001 Sepolia ETH
发送方：0x000071424bb08b910f0786e04D964A63D64bF1Ba
接收方：0x000071424bb08b910f0786e04D964A63D64bF1Ba
交易 Hash：0xafa85a4a18c98881464e64b040169e96d4ca614969641c03bec8f16db0a95d17
```

[查看转账成功详情](https://sepolia.etherscan.io/tx/0xafa85a4a18c98881464e64b040169e96d4ca614969641c03bec8f16db0a95d17)。

## 8. 在 Remix 创建并编译合约

1. 打开 [Remix](https://remix.ethereum.org/)。
2. 选择现有 `firstcontract` 工作区；从零操作时，新建同名空白工作区。
3. 创建 `contracts/Counter.sol`，把第 3 步的源码完整粘贴进去。
4. 进入左侧 Solidity Compiler，按下方配置编译器。
5. 点击 `Compile Counter.sol`，确认编译成功并出现 `Counter` 合约。

```text
Compiler：0.8.24+commit.e11b9ed9
Language：Solidity
EVM Version：shanghai
Optimization：关闭
```

Foundry 和 Remix 是两个独立环境。修改本地文件后，需要重新把最新源码导入 Remix，它们不会自动同步。

## 9. 在 Remix 部署到 Sepolia，或加载现有合约

### 9.1 连接钱包并核对网络

进入 `Deploy & Run Transactions`，选择：

```text
Environment：Browser Extension
Wallet：MetaMask
Network：Sepolia（11155111）
Contract：Counter
Value：0 Wei
```

较旧版本 Remix 可能把浏览器钱包入口叫作 `Injected Provider - MetaMask`。本次界面使用 `Browser Extension`，连接方式见 [Remix 官方说明](https://remix-ide.readthedocs.io/en/latest/run.html)。

若选择 `Remix VM`，交易只在浏览器模拟环境中执行，不是 Sepolia 部署。

### 9.2 部署一个新实例

点击 `Deploy`，在 MetaMask 中核对并确认。等待 `Deployed Contracts` 出现合约实例，记录合约地址与部署交易 Hash。

本次已经部署成功的记录：

```text
Counter 合约地址：0x822A124B56f329D6B72aF26af75E2596d828E9Bc
部署交易 Hash：0xe9ae0bc02071d81ed83f48d84b578b12e75efd3ad749bc06ea18fca4d98ddd69
```

[查看部署成功详情](https://sepolia.etherscan.io/tx/0xe9ae0bc02071d81ed83f48d84b578b12e75efd3ad749bc06ea18fca4d98ddd69)。

### 9.3 继续使用已经部署的合约

无需再次点击 `Deploy`。编译同一份源码后，点击 `Add Contract`，输入下面地址并添加：

```text
0x822A124B56f329D6B72aF26af75E2596d828E9Bc
```

添加现有实例不需要 Gas。新部署实例的 `get()` 初始值是 `0`；现有实例在本次操作完成时已经是 `5`。

## 10. 在 Remix 调用 get() 和 add(5)

1. 展开合约的 `Functions`，选择 `get`，点击 `Call`，查看返回值。
2. 选择 `add`，在参数中填写 `5`，保持 `Value` 为 `0 Wei`。
3. 点击 `Transact`，在 MetaMask 核对并确认交易。
4. 等待交易成功后，重新选择 `get` 并点击 `Call`，刷新结果。
5. 记录本次 `add(5)` 的交易 Hash。

```text
新实例：0 → add(5) → 5
已经为 5 的实例：5 → 再次 add(5) → 10
```

`add(5)` 的含义是“加上 5”，不是“设为 5”。本次已经成功执行的交易是：

```text
0x243600974db99281b7b824532e81cbf629e328d024944d3150b6c357def29cd4
```

## 11. 使用 Cast 独立核验 Sepolia 结果

这些查询不需要钱包私钥，也不会发起新的链上交易。

### 11.1 设置公开参数并确认网络

在同一个终端执行本节命令：

```bash
export COUNTER_SEPOLIA_RPC="https://ethereum-sepolia-rpc.publicnode.com"
export COUNTER_SEPOLIA_ADDRESS="0x822A124B56f329D6B72aF26af75E2596d828E9Bc"
export COUNTER_ADD_TX="0x243600974db99281b7b824532e81cbf629e328d024944d3150b6c357def29cd4"

cast chain-id --rpc-url "$COUNTER_SEPOLIA_RPC"
```

应返回 `11155111`。

### 11.2 查询余额

```bash
cast balance 0x000071424bb08b910f0786e04D964A63D64bF1Ba \
  --ether \
  --rpc-url "$COUNTER_SEPOLIA_RPC"
```

`--ether` 让余额以 ETH 单位显示。

### 11.3 读取当前计数

```bash
cast call "$COUNTER_SEPOLIA_ADDRESS" \
  "get()(uint256)" \
  --rpc-url "$COUNTER_SEPOLIA_RPC"
```

### 11.4 查询交易回执和原始参数

```bash
cast receipt "$COUNTER_ADD_TX" \
  --rpc-url "$COUNTER_SEPOLIA_RPC"

cast tx "$COUNTER_ADD_TX" \
  --rpc-url "$COUNTER_SEPOLIA_RPC"
```

回执重点查看 `status`、`blockNumber`、`gasUsed` 和 `effectiveGasPrice`。状态 `1` 表示成功，`0` 表示执行失败。`cast tx` 可查看交易的发送方、目标、金额和输入数据。

```text
实际 Gas 费用（wei）= gasUsed × effectiveGasPrice
1 ETH = 10^18 wei
```

### 11.5 验证调用前后的历史状态

```bash
cast call "$COUNTER_SEPOLIA_ADDRESS" \
  "get()(uint256)" \
  --block 11645593 \
  --rpc-url "$COUNTER_SEPOLIA_RPC"

cast call "$COUNTER_SEPOLIA_ADDRESS" \
  "get()(uint256)" \
  --block 11645594 \
  --rpc-url "$COUNTER_SEPOLIA_RPC"
```

两次分别返回：

```text
0
5
```

历史查询可以固定复现这次结果；当前值可能被后续交易改变。公共 RPC 如果限流或不提供历史状态，需要更换支持相应查询的节点。

本次 MetaMask 使用 EIP-7702（type 4）交易，因此交易最外层的 `to` 与 Counter 地址不同。已核对 [Blockscout 内部调用](https://eth-sepolia.blockscout.com/tx/0x243600974db99281b7b824532e81cbf629e328d024944d3150b6c357def29cd4)确实执行到了 Counter。作业的合约地址仍是 `0x822A124B56f329D6B72aF26af75E2596d828E9Bc`。

本次还比对了链上完整运行字节码与本地编译结果，两者一致。源码验证已在 [Blockscout](https://eth-sepolia.blockscout.com/address/0x822A124B56f329D6B72aF26af75E2596d828E9Bc?tab=contract)和 [Sourcify](https://repo.sourcify.dev/11155111/0x822A124B56f329D6B72aF26af75E2596d828E9Bc/)成功；Etherscan 因未配置 API key 跳过，Routescan 查询超时，不影响部署交易已经成功的事实。

## 12. 整理截图、提交 GitHub 和提交答案

### 12.1 整理作业材料

作业材料需要对应四件事：

```text
Remix 编译成功
Sepolia 部署成功
add(5) 后 get() 返回 5
Sepolia 转账成功
```

实际截图已经保存：

- [Remix 编译成功](screenshots/01-remix-compiled.jpg)
- [Sepolia 部署成功](screenshots/02-sepolia-deployed.jpg)
- [get() 返回 5](screenshots/03-remix-get-five.jpg)
- [Sepolia 转账成功](screenshots/04-sepolia-transfer.jpg)

完整交易 Hash、区块号和费用见 [README 提交记录](README.md#提交记录)。本次三笔交易合计 Gas 为 `0.000820815697960964` Sepolia ETH，低于用户授权的 `0.001` 上限。

### 12.2 查看已有 GitHub 提交

代码和原始作业材料已经推送到 [GitHub 作业目录](https://github.com/woyaofei303/block-chain-list/tree/main/firstcontract)。查看原始提交：

```bash
cd "/Users/julian/Documents/Codex/2026-09-03/block-chain-list"

git status --short
git show --stat 43c0c1d
git show 43c0c1d -- firstcontract
```

`43c0c1d` 是代码与链上作业材料的原始提交，不是后续操作指南的提交。

### 12.3 以后修改后的验证、提交与推送

修改合约或补充截图后，在仓库根目录执行：

```bash
forge fmt --root firstcontract --check
forge test --root firstcontract -vv

git diff -- firstcontract
git add -- firstcontract
git diff --cached --check
git diff --cached --stat
```

确认暂存区只包含准备提交的改动，且前面的检查都成功后，再执行：

```bash
git commit -m "docs: update firstcontract exercise"
git push origin main
```

没有新改动时无需重复提交。截图和文档可以提交；编译产物、缓存和钱包秘密不提交。

### 12.4 在课程页面提交答案

进入[课程答题页](https://learnblockchain.cn/quest/ffadfacf-91cf-4f69-bea3-12226bb8ecca/challenging)，在回答框填写 `add(5)` 的交易浏览器链接，再点击提交：

```text
https://sepolia.etherscan.io/tx/0x243600974db99281b7b824532e81cbf629e328d024944d3150b6c357def29cd4
```

这里提交的是调用交易链接，不是合约地址，也不是部署交易链接。本次仅完成 GitHub 材料提交，未代为提交登链答题表单。

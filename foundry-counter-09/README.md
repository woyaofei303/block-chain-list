# 09 · 用 Foundry 测试、部署和读取合约

本项目把第 04 课的简单计数器扩展成完整工具练习，并增加基于 OpenZeppelin 的 ERC20。你会区分“编译成功、测试通过、部署模拟、实际链上部署”四件事。

## 先理解要观察的结果

Counter 的 `number` 初始为 0。调用 `setNumber(7)` 后变 7，再 `increment()` 后变 8。两次写入都会发出 `NumberChanged22` 事件，包含旧值和新值。

MyToken 在部署时接收名称和符号，发行 100 亿枚给部署者。`decimals = 18`，所以链上总量为 `10_000_000_000 × 10^18`。它复用 OpenZeppelin ERC20，不必在这里重写授权和转账。

## 准备工具并运行测试

Foundry 中，Forge 负责编译、测试与执行部署脚本；Anvil 是本机测试链；Cast 用于向节点读数据或发交易。先装好这三个命令，再从仓库根目录执行：

```bash
cd foundry-counter-09
forge fmt --check
forge build --sizes
forge test -vv
```

测试覆盖计数、发行量、转账、授权及失败路径。带随机输入的测试叫模糊测试，用多组值检查同一规则；通过不等于所有可能输入都已穷尽。

`lib/forge-std`、`lib/openzeppelin-contracts` 已随仓库保存，不用初始化子模块。其他项目也会复用这里的库，学习时保持目录结构。

## 先模拟脚本：不连接节点、不广播

仍在本项目目录执行：

```bash
forge script script/Counter.s.sol:CounterScript
forge script script/MyToken.s.sol:MyTokenScript --sig 'run(string,string)' 'My Token' 'MTK'
```

第一条创建 Counter；第二条把名称、符号传给 `run`。它们只在临时 EVM 中执行；输出了地址，不代表这个地址已存在于某条持续运行的链上。

## 再部署到独立本地链

终端一从仓库根目录进入本项目，确认 18545 未被占用后启动。`--silent` 避免在终端打印测试账户秘密：

```bash
cd foundry-counter-09
anvil --host 127.0.0.1 --port 18545 --silent
```

终端二也进入本项目。下面账户是 Anvil 默认的公开测试地址，仅用于这个本地实例：

```bash
cd foundry-counter-09
export LOCAL_RPC=http://127.0.0.1:18545
export LOCAL_SENDER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
cast chain-id --rpc-url "$LOCAL_RPC"
forge script script/Counter.s.sol:CounterScript \
  --rpc-url "$LOCAL_RPC" --sender "$LOCAL_SENDER" --unlocked --broadcast
```

chain ID 应为 31337。这里 `--broadcast` 写入本地链，`--unlocked` 使用节点自身的测试账户，不需要复制私钥。

从脚本输出的 Counter 地址，或 `broadcast/Counter.s.sol/31337/run-latest.json` 的部署记录取得地址，再替换下方占位值：

```bash
export COUNTER_ADDRESS='<本次本地部署地址>'
cast call "$COUNTER_ADDRESS" 'number()(uint256)' --rpc-url "$LOCAL_RPC"
cast send "$COUNTER_ADDRESS" 'setNumber(uint256)' 7 \
  --rpc-url "$LOCAL_RPC" --from "$LOCAL_SENDER" --unlocked
cast send "$COUNTER_ADDRESS" 'increment()' \
  --rpc-url "$LOCAL_RPC" --from "$LOCAL_SENDER" --unlocked
cast call "$COUNTER_ADDRESS" 'number()(uint256)' --rpc-url "$LOCAL_RPC"
```

预期先读到 0，最后读到 8。检查交易回执成功再查询，不能把发出请求当成执行成功。停止自己启动的 Anvil 后，本次内存状态不再可用。

## 对照源码阅读

1. [Counter.sol](src/Counter.sol)：状态写入与事件的关系；事件不是第二份可修改的计数器。
2. [Counter.t.sol](test/Counter.t.sol)：`setUp` 怎样为测试准备独立实例。
3. [Counter.s.sol](script/Counter.s.sol)：`startBroadcast` 怎样标记要发送的操作。
4. [MyToken.sol](src/MyToken.sol) 和 [MyToken.t.sol](test/MyToken.t.sol)：继承 ERC20 后只保留发行规则。

2026-10-09 已通过 5 项 Forge 测试，并在独立产物目录模拟运行 Counter 部署脚本；删除空 `setUp` 后仍部署成功，没有广播到公共链。公共链部署还需独立配置网络、加密账户与费用；本课的本地地址不能拿去当 Sepolia 地址使用。

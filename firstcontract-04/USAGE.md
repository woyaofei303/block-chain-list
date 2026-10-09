# Counter 操作指南：从第一次读取到成功加 5

先读 [README](README.md) 的状态例子。本指南分本地练习和历史公共链复习；第一次完成前四节即可，不需要钱包资金。

## 1. 准备工具与文件

浏览器练习用 Remix，命令行测试用 Foundry。Forge 编译和测试；Cast 向节点查询或发交易；Anvil 是持续运行的本地测试链。它们不是三种编程语言。

从仓库根目录执行：

```bash
cd firstcontract-04
forge --version
forge fmt --check
forge build
forge test -vv
```

未安装 Forge 时，先完成 [Foundry 官方安装步骤](https://getfoundry.sh/introduction/installation/)，再回到本目录。项目已经有配置，不要再次 `forge init`。

测试失败时看具体断言；编译器缺失、下载失败与合约行为失败不是同一件事。测试使用临时 EVM，不会替你创建一个持续可访问的部署。

## 2. 把源码放入 Remix 并编译

1. 打开 [Remix](https://remix.ethereum.org/)，创建独立学习工作区。
2. 导入本项目 `contracts/Counter.sol`，不需要导入编译缓存。
3. 编译器选 `0.8.24`，EVM 目标 `shanghai`，关闭优化。
4. 编译 Counter。修改本地文件后须重新导入，Remix 不自动同步本机文件。

编译产物有两类：ABI 描述能调用哪些函数及参数格式；字节码是虚拟机执行的程序。可在项目目录查询 ABI：

```bash
forge inspect Counter abi --json
```

## 3. 部署到 Remix VM

Deploy & Run 中选 Remix VM，使用模拟账户，Value 为 `0 Wei`，部署 Counter。部署是创建一份新状态；重新部署会得到新的计数器，不是修改原实例。

展开刚部署的地址，先 `get()`，预期 0。然后调用 `add(5)`，等待成功，再 `get()`，预期 5。`counter()` 自动生成的查询应和 get 返回相同值。

```text
初始：0
add(5) 成功：5
add(3) 成功：8
add(0) 成功：8
```

切换模拟账户再读仍是 8，因为所有人看同一份合约状态。本实现没有“只有管理员才能 add”的限制。

## 4. 检查一次失败

`uint256` 只能保存一定范围的非负整数。测试会构造超过上限的累加，预期整笔回滚、计数不变。用以下命令读完整调用轨迹：

```bash
forge test --match-test testCounter -vvvv
```

别把失败理解为“先加了一部分”。单笔交易的状态修改要么一起成功，要么回滚；公共链失败交易仍可能消耗 Gas。

当前项目没有独立的 `script/` 部署脚本，本指南用现有测试和 Remix VM。想学习已有 `forge script` 完整例子，继续 [09](../foundry-counter-09/README.md)。

## 5. 只读核对历史 Sepolia 操作

Sepolia 是公共测试网，chain ID 为 `11155111`，与 Remix VM 不共享数据。下面只读查询历史区块，不会发交易；需 RPC 能读取历史状态。在任意有 Cast 的终端执行：

```bash
export COUNTER_RPC=https://ethereum-sepolia-rpc.publicnode.com
export COUNTER_ADDRESS=0x822A124B56f329D6B72aF26af75E2596d828E9Bc
cast chain-id --rpc-url "$COUNTER_RPC"
cast call "$COUNTER_ADDRESS" 'get()(uint256)' --block 11645593 --rpc-url "$COUNTER_RPC"
cast call "$COUNTER_ADDRESS" 'get()(uint256)' --block 11645594 --rpc-url "$COUNTER_RPC"
```

原记录分别为 0 和 5。本次文档重构没有重新访问 RPC，所以它们属于历史预期；不要用当前 `get()` 的数值代替当时的结果。

所有旧交易、截图和费用见 [历史记录](README.md#历史-sepolia-记录2026-09-06)。其中 add 交易通过账户委托执行，顶层交易 `to` 不一定就是 Counter；应结合内部调用和状态变化确认目标。

## 6. 将来自己部署公共测试网时

用本人钱包连接 Sepolia，核对账户、网络、测试币和费用，再按相同编译设置部署。调用前确认选中的是真实部署地址。每次写入分别需要钱包确认，不能从历史教程推断已经授权。

部署后先读 0，再发 add(5)，拿到成功回执后读 5。记录的是**调用 add 的交易哈希**，而不仅是部署哈希。不要把私钥、助记词或密码放进截图。

课程提交材料按原题要求整理；本仓库保留代码和旧证据，本次没有提交课程答案。无需为复习而重复领币、转账或部署。

## 7. 常见卡点

- 看不到刚才的 5：核对网络和合约地址，是否换了新部署。
- add 有交易哈希但 get 不变：查回执是否成功、是否仍待打包。
- Remix 编译结果与本地不同：核对版本、优化器和 EVM 配置。
- Cast 历史查询失败：可能是 RPC 不提供该区块，不等于旧交易失败。

本次仅核对文档、源码和路径，没有重新运行 Forge、Remix 或公共链查询。

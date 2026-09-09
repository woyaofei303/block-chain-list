# BigBank：继承、modifier 与合约管理员

按题图实现的新练习项目，独立于仓库已有的 `bank/`。使用 Solidity `0.8.24`，没有第三方合约依赖。在 Remix 中编译、部署和验证，本地目录只保存源码与说明。

## 题目与实现

- `BigBank is Bank`：继承存款记账、累计存款前三名和管理员提款。
- 每次存款必须 **严格大于 `0.001 ether`**；`minimumDeposit` modifier 同时约束显式 `deposit()` 和直接转账的 `receive()`。
- 当前管理员调用 `transferAdmin(Admin 合约地址)`，将 BigBank 的管理权限交给 Admin。
- Admin 的部署者调用 `adminWithdraw(BigBank 地址)`，由 Admin 调用 BigBank 的 `withdraw()` 并接收全部 ETH。

```text
bigbank/
├── contracts/
│   ├── Bank.sol        # 基类：记账、前三名、提款
│   ├── BigBank.sol     # 派生类：存款门槛、管理员转移
│   └── Admin.sol       # 管理合约：由 owner 发起提款并收款
└── README.md
```

本项目的 Bank 沿用旧练习的代码，在本目录中独立维护。为支持继承扩展，`admin` 改为可更新变量，`_deposit()` 改为 `internal virtual`，提款权限检查复用 `onlyAdmin`。提款时保存收款地址，使回调期间管理员发生变化也不影响提款事件的收款人记录。

## 关键规则

`deposit()` 和 `receive()` 都进入 `_deposit()`；BigBank 只重写这一个共用记账路径，在执行父类记账前检查门槛，因此不会漏掉钱包直接转账。

```text
0 Wei                      → 拒绝
999999999999999 Wei         → 拒绝
1000000000000000 Wei        → 拒绝，恰好 0.001 ether
1000000000000001 Wei        → 接受，0.001 ether + 1 wei
2000000000000000 Wei        → 接受，0.002 ether
```

门槛检查的是每笔 `msg.value`，不是个人累计金额。Bank 基类仍接受任意正数存款，限制只由 BigBank 添加。`deposits(address)` 始终表示历史累计存入金额；提款不会清空历史或排行榜，同额排名保留已有顺序。

管理员与合约所有者是两个不同角色：

```text
部署后：BigBank.admin = BigBank 部署者
        Admin.owner   = Admin 部署者

转移后：BigBank.admin = Admin 合约地址

Admin.owner → Admin.adminWithdraw(BigBank)
            → BigBank.withdraw()
            → ETH 转入 Admin.receive()
```

BigBank 的原管理员转移后不能再直接提款或转移权限。零地址不能成为管理员；非 Admin.owner 不能触发 `adminWithdraw()`；空余额提款会回退；收款失败会整体回滚，提款锁阻止重入。

本题的资金终点是 **Admin 合约**。当前 Admin 没有将 ETH 再转给 owner 或替 BigBank 再次转移管理员的接口；本项目按本地模拟练习使用。

## 自定义错误：怎么定义、怎么看

三个合约统一使用无参数自定义错误，不再用字符串报错。错误声明放在所属合约内部、函数外部；BigBank 自动继承 Bank 的错误，无需重复声明。只有多个没有继承关系的合约确实需要共享错误时，再考虑合约外定义。

```solidity
contract BigBank is Bank {
    /// @notice 新管理员不能是零地址。
    error InvalidAdmin();

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) {
            revert InvalidAdmin();
        }
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
    // 其他代码省略
}
```

`error` 只定义错误类型；`revert InvalidAdmin()` 才会终止执行、回滚本次调用并返回错误数据。不能写成 `return "Invalid admin"`：当前函数没有返回值，而且 `return` 不是失败回滚。

当前错误与含义：

```text
Bank.OnlyAdmin()            只有当前管理员可操作
Bank.ReentrantWithdrawal()  提款期间发生重入
Bank.NothingToWithdraw()    合约余额为零
Bank.WithdrawalFailed()     管理员收款失败
Bank.ZeroDeposit()          Bank 存款金额为零
BigBank.InvalidAdmin()      新管理员是零地址
BigBank.DepositTooSmall()   BigBank 单笔存款不大于 0.001 ether
Admin.OnlyOwner()          只有 Admin 的部署者可发起提款
```

在 Remix 中查看错误：

1. 重新编译新版代码并在 Remix VM 部署新版合约。重新编译不会更新已部署的旧合约。
2. 保持 BigBank 的部署者为当前账户、Value 为 `0 Wei`，调用 `transferAdmin(0x0000000000000000000000000000000000000000)`。
3. 展开底部终端中的失败调用详情。若当前界面已按对应 ABI 解码，可以看到 `InvalidAdmin()`；若只显示原始 `data`，此错误的数据为 `0xb5eba9f0`。

这 4 字节是 `keccak256("InvalidAdmin()")` 的前 4 字节，不是完整错误文字。ABI 中保存了错误名称和参数类型，工具据此解码；中文 `@notice` 注释用于源码与文档，不会自动成为钱包弹窗内容，也不会增加链上的错误返回数据。[Solidity 官方说明](https://docs.soliditylang.org/en/v0.8.24/contracts.html#errors-and-the-revert-statement)

使用 ethers v6 的程序可以这样解码原始错误数据；以下是独立使用示例，本项目无需安装 ethers：

```js
import { Interface } from "ethers"

const abi = ["error InvalidAdmin()"]
const iface = new Interface(abi)
const error = iface.parseError("0xb5eba9f0")
console.log(error?.name) // InvalidAdmin
```

实际项目传入编译器生成的 ABI 即可。如果通过 `Admin.adminWithdraw()` 收到 Bank 抛出的错误，需要使用包含该错误的 Bank/BigBank ABI；Admin 自己的 ABI 只声明 `OnlyOwner()`。`parseError` 找不到匹配错误时返回 `null`。[ethers 官方文档](https://docs.ethers.org/v6/api/abi/#Interface-parseError)

## 在 Remix VM 手动复现

1. 打开 [Remix](https://remix.ethereum.org/)，新建 `bigbank` 工作区，将 `contracts/` 中三个源码文件按相同目录导入。
2. 编译器选择 `0.8.24`，EVM 选择 `shanghai`，关闭优化。编译 `BigBank.sol` 和 `Admin.sol`。
3. Deploy & Run 中选择 **Remix VM**，账户选账户 0，Value 设为 `0 Wei`，分别部署 BigBank 和 Admin，记录两个地址。
4. 查询 BigBank 的 `admin()` 和 Admin 的 `owner()`，都应是账户 0。
5. 切换账户 1，将 Value 设为 `1000000000000000 Wei`，调用 BigBank 的 `deposit()`，应回退。改成 `1000000000000001 Wei`，再次调用应成功。
6. 查询 `deposits(账户 1 地址)` 和 `getTop3()`，记录累计存款与余额。也可以用空 Calldata、上述合格 Value 的低级交易调用 BigBank，验证 `receive()` 入口。
7. Value 恢复为 `0 Wei`，切回账户 0，在 BigBank 调用 `transferAdmin()`，参数填 **Admin 合约地址**。查询 `admin()`，应等于该地址。
8. 账户 0 直接调用 BigBank 的 `withdraw()`，应报 `OnlyAdmin()`。
9. 切换账户 1，在 Admin 调用 `adminWithdraw()`，参数填 BigBank 地址，应报 `OnlyOwner()`。
10. 切回账户 0，在 Admin 调用 `adminWithdraw(BigBank 地址)`，应成功：BigBank 余额归零，Admin 余额增加相同金额，个人历史和排行榜保留。

## 验证记录与范围检查

当前保留三个业务合约和 Remix 操作说明。本次自定义错误调整已通过 Solidity `0.8.24` 编译及独立本地 EVM 验证：8 类错误的返回标识、两个存款入口、管理员转移与提款、拒收回滚和重入保护均通过。临时校验脚本位于仓库已忽略的 `output-tdd/bigbank-custom-errors/`，不属于项目依赖。

以上 Remix 步骤仍是待执行流程，尚未在 Remix 页面完成验证或部署到测试网。

```sh
git status --short --untracked-files=all -- bigbank
git diff -- bigbank
```

新增文件在 `git add` 前不显示于普通 `git diff`，可通过 `git status` 列表逐个查看。本项目不需要提交或推送才能运行。

实现参考：[Solidity 0.8.24 modifier](https://docs.soliditylang.org/en/v0.8.24/contracts.html#function-modifiers)、[继承与重写](https://docs.soliditylang.org/en/v0.8.24/contracts.html#inheritance)。

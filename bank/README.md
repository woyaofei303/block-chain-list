# Bank：Remix 合约练习

使用 Remix 编写、编译、测试和部署 Bank；MetaMask 向合约转入 ETH，部署者提取合约全部余额。

## 文件

- `contracts/Bank.sol`：独立合约，无第三方合约依赖。
- `tests/Bank_test.sol`：Remix Solidity Unit Testing 测试，包含管理员收款回调。
- `tests/BankDepositor.sol`：模拟不同存款人的辅助合约；单独导入，避免被 Remix 当成测试套件。
- `README.md`：规则、操作步骤和实际验证记录。

## 已确定的规则

- 部署者是固定管理员，`admin()` 返回其地址。
- `deposits(address)` 表示历史累计存入金额，单位 Wei；不是用户可自行提取的余额。
- `receive()` 接收钱包直接转账，`deposit()` 支持在 Remix 点击存款，两者共用记账逻辑；零金额会回退。
- `top3(0)` 到 `top3(2)` 按累计金额降序排列；`getTop3()` 一次返回三个地址和对应金额。空位为零地址、零金额。
- 同额保持已有顺序；榜外地址与第三名同额时不替换，只有严格超过才改变相对排名。
- `withdraw()` 仅管理员可调用，全部 ETH 转回管理员；空余额提款、重入和收款失败均回退。
- 提款不清空累计存款和排行榜，之后的新存款继续累计。
- 存款和提款分别发出 `Deposited`、`Withdrawn` 事件。

只有当前存款人的累计金额增加，因此排行榜只检查三个位置，无需遍历全部存款人。榜内地址向前移动，榜外地址先与第三名比较；同额比较使用严格大于，避免重复地址和同额挤榜。

合约实际余额直接读取链上余额，不能用累计存款之和代替：提款会降低实际余额；不触发存款入口的强制 ETH 转入也不会计入个人历史。管理员提取的是实际余额。

## 在 Remix 导入与编译

1. 打开 [Remix](https://remix.ethereum.org/)，创建空工作区 `bank`。本次官方入口自动跳转至 `https://app.remix.live/`。
2. 建立 `contracts`、`tests` 两个文件夹，将本项目同名文件导入对应目录。不能上传时，可以新建同名文件并粘贴源码。先选中项目根目录再创建文件夹，避免将 `tests` 建在 `contracts` 内。
3. 在 Solidity Compiler 中选择 `0.8.24+commit.e11b9ed9`，EVM Version 选 `shanghai`，关闭 Optimization。
4. 打开 `contracts/Bank.sol` 并编译。当前界面也可从顶部 Compile 旁的下拉菜单选择 **Open compiler configuration**。部署时选择 **Bank**，不要选择测试合约。

源码固定 Solidity `0.8.24`，与本仓库前一个练习一致。以后加载已部署合约时，也使用相同源码和编译设置。

## 运行自动化测试

1. 在 Plugin Manager 中启用 **Solidity Unit Testing**。
2. 测试目录选择 `tests`，勾选 `Bank_test.sol`，点击 Run。
3. 查看九项测试的通过/失败结果。`remix_tests.sol` 由测试插件注入，无需下载或安装依赖。

测试中的 `#value` 使用 Wei，测试插件自动提供模拟资金。四个辅助存款合约让 Bank 实际看到四个不同的调用地址，避免把测试函数的 `msg.sender` 误当成 Bank 的调用者。每项测试部署全新的 Bank，部署它的测试合约充当管理员。

测试覆盖：

1. 管理员、空余额和空排行榜的初始状态。
2. `deposit()` 与直接转账累计记账。
3. 不足三名、榜外入榜、同额不替换、跨越多个排名。
4. 榜内追加存款、同额不换位、地址不重复。
5. 两个入口的零金额拒绝、空余额提款拒绝。
6. 非管理员提款拒绝且保留资金。
7. 管理员收到全部余额，历史保留，再次存款和提款。
8. 收款失败回滚、资金和排行榜保留，之后可重试。
9. 管理员收款回调尝试重入，被提款锁阻止，外层提款成功。

## Remix VM 手动演练

1. Deploy & Run 中选择 **Remix VM**，Account 选账户 0，Value 设为 `0 Wei`，部署 Bank。
2. 调用 `admin()`，确认它等于账户 0。记录此模拟合约地址。
3. 切换账户 1，Value 设为 `1 Ether`，点击 `deposit()`。
4. 切换账户 2、3，分别存入 `2 Ether`、`3 Ether`；查询 `getTop3()`，应为账户 3、2、1。
5. 切换账户 4，存入 `2 Ether`；前三名应为账户 3、2、4，同额的账户 2 保持在前。
6. 账户 1 再存 `1 Ether`：累计为 2，与第三名同额，仍不上榜。再存 `2 Ether`：累计为 4，升至第一名。
7. Value 恢复为 `0 Wei`。用非管理员账户调用 `withdraw()`，应提示 `Only admin`。
8. 切回账户 0，调用 `withdraw()`，合约余额变为 0；历史金额和排行榜不变。
9. 再存入小额模拟 ETH，确认合约继续接收，累计金额继续增长。

这些 Ether 金额只用于 Remix VM 模拟；不要照搬到测试网。`withdraw()` 不是 payable，调用前必须把 Remix 的 Value 归零。

## Sepolia 与 MetaMask 实操

1. 将 MetaMask 切换到 **Sepolia**（chain ID `11155111`），确认选中的部署账户及测试币余额；已有测试币时直接复用。
2. Remix Deploy & Run 选择 **Browser Extension** 并连接 MetaMask（较旧版本名称为 Injected Provider - MetaMask）。核对网络、账户，Value 保持 `0 Wei`。
3. 选择 Bank，核对部署交易的预估 Gas 后由钱包确认部署。部署账户将永久成为管理员。
4. 记录合约地址和部署交易 Hash，调用 `admin()` 核对管理员。
5. 在 MetaMask 使用 Send，将少量 Sepolia ETH 发给该合约地址，不附加调用数据。建议演示金额为 `0.00001 Sepolia ETH`，具体交易和 Gas 以签名前确认内容为准。
6. 等待回执成功，回到 Remix 调用 `deposits(发送地址)` 和 `getTop3()`。`0.00001 ETH` 对应 `10000000000000 Wei`。
7. 如需验证另一个入口，在 Remix 填写同样的小额 Value，调用 `deposit()`，再核对累计金额。
8. Value 归零，切回管理员账户调用 `withdraw()`，核对回执、合约余额为 0、历史记录和排行榜保留。
9. 保存部署、直接存款和提款的交易 Hash，以及编译、测试、记账和提款后的截图。多地址排行榜的完整边界已由 VM 测试覆盖；测试网上如需多地址演示，再使用本人已有的测试账户。

钱包直接存款会执行记账和排名逻辑，需要由钱包估算合约调用所需 Gas，不能固定成普通地址转账的 21,000。其他合约使用只有 2,300 Gas 津贴的 `send` / `transfer` 也无法完成此记账，应调用 `deposit()` 或使用能够提供足够 Gas 的调用方式。

连接钱包、部署、存款和提款分别核对对应操作；私钥、助记词和密码不得保存到本项目。截图与本地验证产物保存到仓库的 `output-tdd/`，不纳入代码提交。

## 实际验证与部署记录

2026-09-08 已在 Chrome 的 Remix `bank` 工作区完成以下验证：

- Bank 编译成功：Solidity `0.8.24+commit.e11b9ed9`、EVM `shanghai`、Optimization 关闭。
- Solidity Unit Testing：**9 项通过，0 项失败，最终复核耗时 12.73 秒**。
- 通过编辑器复制读取，核对三个 Solidity 文件与本地文件的非空白内容一致。
- Sepolia 部署成功：RPC 交易回执 `status=0x1`，区块 `11658519`；链上运行代码为 `4309` 字节，`admin()` 返回下面的钱包地址。
- 部署消耗 Gas `981608`，实际 Gas 费用 `0.002534424113005704 Sepolia ETH`，部署 Value 为 `0 Wei`。
- 直接存款与管理员提款尚未执行，等待对具体金额和剩余 Gas 上限的授权。

```text
Remix 编译：通过
Remix 自动化测试：9 passed / 0 failed
网络：Sepolia
管理员地址：0x000071424bb08b910f0786e04d964a63d64bf1ba
Bank 合约地址：0x61Ff21654B8221Aa61D0378859c27049281e029E
部署交易 Hash：0xa5be452b7a40c135a16b9a6ec1866a358e64a9e6bba17e8607c51e148ae72091
直接存款交易 Hash：待操作
管理员提款交易 Hash：待操作
```

- [Bank 合约](https://sepolia.etherscan.io/address/0x61Ff21654B8221Aa61D0378859c27049281e029E)
- [部署交易](https://sepolia.etherscan.io/tx/0xa5be452b7a40c135a16b9a6ec1866a358e64a9e6bba17e8607c51e148ae72091)
- [本地测试截图（九项结果与汇总）](../output-tdd/playwright/bank/04-remix-tests-final.png)
- [本地编译截图](../output-tdd/playwright/bank/02-remix-compiled.png)
- [本地部署截图](../output-tdd/playwright/bank/03-sepolia-deployed.png)

截图和 RPC 读取结果只保存在本地的 `output-tdd/playwright/bank/`。

## 官方资料

- [Remix 编译与部署](https://remix-ide.readthedocs.io/en/latest/run.html)
- [Remix Solidity Unit Testing](https://remix-ide.readthedocs.io/en/latest/unittesting.html)
- [Solidity 接收 ETH](https://docs.soliditylang.org/en/v0.8.24/contracts.html#receive-ether-function)
- [Solidity 重入与转账安全](https://docs.soliditylang.org/en/v0.8.24/security-considerations.html#reentrancy)
- [Sepolia 与测试币来源](https://ethereum.org/developers/docs/networks/#sepolia)

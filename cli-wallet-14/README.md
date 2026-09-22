# Sepolia 命令行钱包

题目来自本次命令行钱包练习：生成私钥并查询余额、构建 ERC20 EIP-1559 交易、用生成的账户签名、发送到 Sepolia。参考[《如何手动构造以太坊交易》](https://learnblockchain.cn/article/6897)的构建、签名、发送和回执流程。

实现选择：Node.js 24+、TypeScript strict、npm、Ethers v6。私钥在本机随机生成，保存为密码加密的 keystore；终端只显示公开地址。转账默认只模拟，添加 `--send` 并交互确认后才签名和广播。本项目没有前端、数据库或部署脚本。

## 安装与配置

从**仓库根目录**执行：

```bash
cd cli-wallet-14
npm ci
test -f .env || cp .env.example .env
```

之后的命令均在 **`cli-wallet-14` 项目目录**执行。使用 `.env.example` 中的公开 Sepolia RPC，或者在 `.env` 修改 `SEPOLIA_RPC_URL` 为自己的 HTTP/HTTPS 地址。程序强制核对 chain ID `11155111`，不提供切换主网的参数。

```bash
npm run wallet -- --help
```

## 1. 生成私钥、充值与查询余额

```bash
npm run wallet -- create
```

在终端隐藏输入至少 12 字符的密码，再输入一次确认。程序生成随机账户，将私钥加密保存到 `.wallet/keystore.json`，仅打印钱包地址。已存在的文件不会被覆盖；创建无需 RPC。密码和 keystore 都需要妥善保管，忘记密码无法解密。文件权限为 `0600`，目录为 `0700`，`.wallet/` 已被 Git 忽略；程序不提供明文私钥导出。

手动向输出地址转入 **Sepolia ETH** 支付 Gas，以及同一网络上的 **ERC20 测试币**。这两种余额分别查询，钱包不会自动领水或发币。

```bash
npm run wallet -- balance
```

选择已持有的 Sepolia ERC20 和收款地址，替换以下占位值：

```bash
export TOKEN_ADDRESS='0x替换成Sepolia的ERC20合约地址'
export RECIPIENT_ADDRESS='0x替换成收款地址'
npm run wallet -- balance --token "$TOKEN_ADDRESS"
```

也可只读查询任意公开地址，不要求本地已有钱包或输入密码：

```bash
npm run wallet -- balance --address "$RECIPIENT_ADDRESS" --token "$TOKEN_ADDRESS"
```

代币必须实现标准的 `decimals()`、`balanceOf(address)` 和返回 `bool` 的 `transfer(address,uint256)`；精度从合约读取，不固定为 18。余额按精度显示为十进制字符串，链上金额始终为 `bigint`。

## 2. 构建 ERC20 EIP-1559 交易

以下示例转账 **1.25 个代币**，每单位 Gas 最高 **20 gwei**；这些是示例值，使用时自行选定金额和费用上限：

```bash
npm run wallet -- transfer \
  --token "$TOKEN_ADDRESS" \
  --to "$RECIPIENT_ADDRESS" \
  --amount 1.25 \
  --max-fee-gwei 20
```

程序核对网络、地址、合约代码和代币余额，先估算 Gas 并核对 ETH 是否覆盖费用上限，再带上明确的 `gasLimit` 用 `eth_call` 模拟 `transfer`。输出完整交易字段、真实收款人、代币数量及总费用上限。此步骤不解锁钱包、不签名、不广播。显式指定模拟 Gas 可以避免部分 RPC 使用超大的默认 Gas 数量，导致余额充足时仍误报费用不足。

字段含义：

- `type = 2`、`chainId = 11155111`：Sepolia 的 EIP-1559 交易。
- `from`：本机 keystore 对应账户；`nonce` 从 `pending` 状态读取。
- `to`：**ERC20 合约地址**；`recipient` 是预览额外展示的实际收款人，不是交易协议字段。
- `value = 0`：不随合约调用发送 ETH；代币金额在 `data` 中。
- `data`：ABI 编码后的 `transfer(recipient, amount)`。例如精度为 6 时，`1.25` 编码为 `1250000`。
- `maxFeePerGas`：显式设置的最高 Gas 单价；`maxPriorityFeePerGas` 读取 RPC 建议值。两者均为 wei，不使用旧式 `gasPrice`。
- `gasLimit`：估算值加 20% 余量并向上取整；ERC20 调用不能把 Gas 写死为 21000。
- 总费用上限为 `gasLimit × maxFeePerGas`；实际费用以回执为准。小数位过多会报错，不会静默舍入。

## 3–4. 用生成的账户签名并发送到 Sepolia

核对同样的参数后显式添加 `--send`：

```bash
npm run wallet -- transfer \
  --token "$TOKEN_ADDRESS" \
  --to "$RECIPIENT_ADDRESS" \
  --amount 1.25 \
  --max-fee-gwei 20 \
  --send
```

此命令会重新获取当前交易参数和模拟结果，展示账户、代币、收款人、金额和费用上限。输入 `SEND`，再隐藏输入 keystore 密码后，程序依次执行：

1. 解密第一步生成的账户，核对其地址与交易发送方一致。
2. 调用 `wallet.signTransaction(transaction)`，得到以 `0x02` 开头的已签名 EIP-1559 序列化交易；签名与广播是两个独立步骤。
3. 本地计算并显示交易哈希，广播前再次检查网络、pending nonce 和模拟结果。
4. 先写入 `.wallet/<交易哈希>.json`，再调用 `provider.broadcastTransaction(signed)`，底层使用 `eth_sendRawTransaction`。
5. 等待一次区块确认，最多等待 120 秒；成功后显示区块和实际 Gas 费用，并提供 Sepolia Etherscan 链接。

签名原文只在内存中传递，不写入文件或终端。交易记录只保存公开的哈希、发送方、nonce 和 chain ID；有记录不表示广播成功。

### 超时、中断或回滚

若已打印本地交易哈希，先查询该哈希，**不要直接重复执行转账**：

```bash
npm run wallet -- receipt --hash 0x替换成完整交易哈希
```

有回执时显示执行成功或失败；尚无回执只能说明当前 RPC 未返回回执，不能推断交易没有广播。广播超时不会自动重发。`receipt` 不会发送交易；Gas 不足、nonce 改变、模拟失败、密码错误都会终止当前操作。

## 阅读顺序与文章对应关系

1. `src/cli.ts`：命令解析 → 隐藏密码输入 → 调用钱包函数 → 展示结果与确认 → 清理连接。
2. `src/wallet.ts`：`createWallet` / `walletAddress` → `tokenBalance` → `buildTransfer` → `signTransfer` → `broadcast`。
3. `test/wallet.test.ts`：金额、地址与精度边界 → 加密钱包和签名恢复 → 错误网络、余额、nonce、RPC 超时与原文件保护。

参考文章讲解交易字段、RLP 编码与底层 RPC。本练习显式构建 Type 2 字段，把 RLP 和 secp256k1 签名交给 Ethers；链固定为 Sepolia，转账内容改为 ERC20 合约调用。Ethers 的 `signTransaction` 完成序列化与签名，`broadcastTransaction` 负责发送，两步没有合并为快捷转账调用。

官方资料：[Ethers 钱包和交易 API](https://docs.ethers.org/v6/single-page/)、[JSON-RPC Provider](https://docs.ethers.org/v6/api/providers/jsonrpc/)、[EIP-1559 交易格式](https://eips.ethereum.org/EIPS/eip-1559)。

## 验证与限制

从**项目目录**执行（测试不连接公共网络）：

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
```

Node 原生测试使用临时加密钱包和模拟 RPC，结束时清理临时文件。项目通过共享 Husky 钩子接入 `lint-staged → Biome → typecheck → test`；保留仓库原有检查，`prepare` 使用原来的 `core.hooksPath`。

2026-09-21 实测（Node.js 24.14.0）：lint、格式检查、严格类型检查和 3 个原生测试通过。另在独立端口的本地 Anvil（chain ID 11155111）部署临时测试代币，实际通过终端创建加密钱包、查询余额、默认预览及 `--send` 交互，核对 Type 2 交易、1.25 个代币的双方余额变化、Transfer 事件和成功回执；节点和测试钱包已清理。这是本地 EVM 验证，不是公共 Sepolia 交易。

公共 Sepolia RPC 的只读余额查询通过，未在公共链签名或广播。提交门禁使用临时 Git index 实测 lint-staged / Biome，执行本包 `precommit` 的类型检查和测试，并以模拟 npm/pnpm 验证共享钩子分派；未重跑其他项目的测试，真实暂存区未改动。

2026-09-21 补充验证：修复部分 Sepolia RPC 在 `eth_call` 缺少 Gas 上限时按超大默认值检查费用的问题。已用 25 MTK、20 gwei 上限完成公共 Sepolia 的只读预览：估算 35430 Gas，加余量后 42516 Gas，总费用上限 0.00085032 ETH，模拟返回成功；未签名、未广播。测试同时复现该节点的默认 Gas 行为，覆盖构建和广播前模拟；Biome 排除 `.wallet/`，避免格式工具改动本地加密钱包和交易记录。

- 这是单账户、手动串行操作的学习脚本；不支持并行发交易、替换交易、自动加价或离线签名文件导入。
- 仅支持返回 `bool` 的标准 ERC20；不兼容不返回数据的历史代币。特殊代币的手续费、暂停或转账限制由合约决定，成功回执不能替代业务余额核对。
- 网络报价和状态会变化，模拟成功不是上链保证；费用上限过低可能导致节点拒绝或长时间等待。
- 本项目的代码交付不代表已经在公共 Sepolia 转账。实际发送须由操作者准备测试币、核对参数并在终端确认。

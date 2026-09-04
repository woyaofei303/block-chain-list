# Node.js 区块链教学作业

这个项目用最小可运行节点覆盖三件事：SHA-256 + nonce 的 PoW、交易入块，以及两个独立节点间的交易/区块广播与落后节点同步。运行环境为 Node.js 20+、ESM，除 WebSocket 的 `ws` 外只使用标准库。

## 架构

HTTP 是用户操作面：提交交易、挖矿、查看状态；WebSocket (`/p2p`) 是节点间的持续连接。节点连接后发送 `HELLO`；链头不同时发送 `GET_CHAIN` 并接收完整 `CHAIN`。新交易和新区块分别以 `TRANSACTION`、`BLOCK` 广播，按 ID/哈希去重。

- `src/blockchain.mjs`：交易、区块哈希、PoW 和链验证。
- `src/node.mjs`：HTTP API、P2P 协议，以及可直接运行的 CLI。
- `demo.mjs`：启动两个真实子进程，验证晚加入同步和实时广播。

## 数据字段

交易为 `{ id, from, to, amount, timestamp }`：`from`/`to` 是非空字符串，`amount` 为正的有限数字；`id` 是规范化交易内容的 SHA-256，用于去重。

区块为 `{ index, timestamp, transactions, previousHash, difficulty, nonce, hash }`：`hash` 覆盖其余全部字段，`previousHash` 连接上一区块，`nonce` 递增到哈希满足 `difficulty` 个十六进制前导零。默认难度是 4；每个节点启动后使用固定难度，不做动态难度调整，也不收取交易手续费。

## 安装、测试与自动演示

```bash
npm install
npm test
npm run demo
```

CLI 支持 `--name`、`--port`、`--difficulty` 与可重复的 `--peer`。启动成功后会在 stdout 打印 `READY`；挖矿、验块和同步耗时打印到 stderr，便于脚本稳定读取 READY。

程序化调用 `createNode()` 时，每次 `start()` 或 `stop()` 都必须按顺序 `await` 完成，不要并发重叠生命周期操作。

## 三终端手动演练

终端 1（安装、测试或自动演示）：

```bash
npm install
npm test
npm run demo
```

终端 2（先启动 node-a）：

```bash
node src/node.mjs --name node-a --port 3001 --difficulty 4
```

终端 3（再启动 node-b，并连接 node-a）：

```bash
node src/node.mjs --name node-b --port 3002 --difficulty 4 --peer ws://127.0.0.1:3001/p2p
```

回到终端 1 提交交易、挖矿并查看 node-b：

```bash
curl -s -X POST http://127.0.0.1:3001/transactions \
  -H 'content-type: application/json' \
  -d '{"from":"alice","to":"bob","amount":10}'

curl -s -X POST http://127.0.0.1:3001/mine

curl -s http://127.0.0.1:3002/status
curl -s http://127.0.0.1:3002/chain
```

按 `Ctrl+C` 会优雅停止节点。

## 断点调试

`--inspect-brk` 会在执行第一行前暂停。打开 Chrome DevTools 的 Node 目标，或在 VS Code 使用 “Attach to Node Process” 即可继续并设断点：

```bash
node --inspect-brk src/node.mjs --name node-a --port 3001 --difficulty 2
```

建议在 `mineBlock()` 的 nonce 循环、HTTP `/mine` 路由，或 P2P 的 `handleMessage()` 处观察数据如何流动。

## 有意保留的教学简化

- 所有数据只在内存中；重启从确定性创世块开始。
- 没有钱包、私钥、签名、余额、UTXO、Gas、合约、手续费、奖励或经济机制。
- 每个节点的难度在启动时固定，没有动态难度调整。
- PoW 在主线程同步运行；难度较低，适合观察，但会短暂阻塞节点。
- 同步直接传整条链，没有区块头、分批下载、Merkle Tree 或二进制编码。
- 没有节点发现、NAT 穿透、数据库和生产级抗攻击保护。

这些取舍让 PoW、交易入块和链替换三条主线可以直接阅读；真实网络需要补齐以上能力。

## 实际运行结果

以下是一次未改动的成功 `npm run demo` 输出（端口和毫秒数每次运行会变化）：

```text
npm warn Unknown user config "sass_binary_site". This will stop working in the next major version of npm.

> node-blockchain-homework@1.0.0 demo
> node demo.mjs

[node-a] HTTP 节点 node-a 已启动：http://127.0.0.1:60539
[node-a] [node-a] READY http://127.0.0.1:60539 p2p=ws://127.0.0.1:60539/p2p
[node-a] 挖矿耗时=1.270 ms
交易1已打包: block=1, tx=1
挖矿耗时: block=1, 1.270 ms
[node-b] HTTP 节点 node-b 已启动：http://127.0.0.1:60540
[node-b] [node-b] READY http://127.0.0.1:60540 p2p=ws://127.0.0.1:60540/p2p
[node-a] 链同步=false, 耗时=0.086 ms
[node-b] 链同步=true, 耗时=0.279 ms
落后节点同步成功: node-a高度=1, node-b高度=1
交易广播成功: node-b待处理交易=1
[node-a] 挖矿耗时=0.421 ms
挖矿耗时: block=2, 0.421 ms
[node-b] 验块=true, 耗时=0.131 ms
新区块广播成功: node-a高度=2, node-b高度=2
两个节点链头一致: true
```

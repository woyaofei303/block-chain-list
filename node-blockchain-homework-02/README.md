# 02 · 从两台节点理解区块链

区块链先可以理解为“多台机器各保存一份按顺序相连的账本”。这个项目让你向 A 提交一条记录、把记录装进区块，再看到 B 同步到同一份内容。先读本篇即可，不需要钱包或测试币。

## 用一笔 10 元的记录串起来

我们输入“alice 给 bob 10”。这里的 10 **只是教学数据**：程序没有余额、签名和扣款，因此不能证明 Alice 真有钱或同意付款。

记录先进入 `mempool`（待打包池），像待处理的收据。挖矿把它装进区块；区块保存上一个区块的哈希，形成先后关系。哈希是内容的数字指纹，改内容通常会改变指纹。

PoW（工作量证明）要求不断更换 `nonce`（尝试次数对应的数），直到区块哈希满足前导零要求。找到答案需要尝试，其他节点复算一次就能检查答案。

## 先跑自动演示

准备 Node.js 20+。在仓库根目录执行：

```bash
cd node-blockchain-homework-02
npm ci
npm test
npm run demo
```

`demo` 自动选择临时端口、使用难度 2，并在结束时关闭自己启动的节点。预期依次看到：交易入块、B 追上 A、交易广播、新区块广播，最后两个节点的链头一致。

测试验证算法与边界；演示让两个真实子进程通信。二者的意义不同。2026-10-09 已通过 29 项测试；本轮未单独重跑完整双节点演示，文末输出仍是历史样例。

## 再亲手操作一次

下面三个终端均从仓库根目录进入本项目。3001、3002 需空闲；如果被占用，换一组端口并同步替换所有 URL。

终端 A：启动第一个节点，等出现 `READY`。

```bash
cd node-blockchain-homework-02
node src/node.mjs --name node-a --port 3001 --difficulty 2
```

终端 B：连接第一个节点。两个节点使用相同难度。

```bash
cd node-blockchain-homework-02
node src/node.mjs --name node-b --port 3002 --difficulty 2 --peer ws://127.0.0.1:3001/p2p
```

终端 C：先提交记录，再打包，最后读 B 的账本。这些请求只修改本机教学节点的内存。

```bash
curl -s -X POST http://127.0.0.1:3001/transactions \
  -H 'content-type: application/json' \
  -d '{"from":"alice","to":"bob","amount":10}'
curl -s -X POST http://127.0.0.1:3001/mine
curl -s http://127.0.0.1:3002/status
curl -s http://127.0.0.1:3002/chain
```

提交成功只说明进入待打包池。执行 `/mine` 后，再检查链中是否出现这条交易；比较双方 `tipHash` 才能判断是否同步到同一链头。完成后分别在 A、B 按 `Ctrl+C`；重启会丢失这次内存账本。

## 代码中的完整路线

```text
POST /transactions → createAndAddTransaction → 校验和去重 → mempool
POST /mine → minePendingTransactions → mineBlock → chain → 广播 BLOCK
B 收到 BLOCK → appendBlock 验证 → 加入 B 的 chain
```

B 晚启动时，不能只收最新一个区块。它先交换 `HELLO`，再请求 `GET_CHAIN`，收到完整 `CHAIN` 后验证并比较累计工作量；只有更大工作量的有效链才会替换本地链。不是“别人发什么就信什么”。

- [blockchain.mjs](src/blockchain.mjs)：从 `mineBlock` 看 nonce，再看 `isValidChain` 如何验整条链。
- [node.mjs](src/node.mjs)：从 HTTP 请求看算法怎样接入网络，再读 P2P 消息处理。
- [demo.mjs](demo.mjs)：看为什么启动要等 `READY`，退出要等资源释放。

程序化调用节点的 `start()` / `stop()` 时要顺序 `await`。PoW 在主线程同步计算，难度增大可能使请求暂时无响应；默认难度 4，不适合直接当生产节点使用。

## 两个小练习

1. 先只启动 A 并挖一个块，再启动 B：B 为什么仍能获得旧交易？因为连接时会同步完整链。
2. 只提交交易不挖矿：为何链长度不变？待打包池与区块链是两份不同状态。

没有钱包验签、持久化、动态难度或真实资金，是这份教学实现的边界。下一步读 [03 的哈希与签名](../pow-rsa-ecc-homework-03/README.md)。

## 历史演示输出（不是本次重跑）

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

# PoW、RSA 与 ECC Node.js 作业

使用 Node.js 完成以下实验：

1. 对“昵称 + nonce”不断计算 SHA-256。
2. 分别找到以 4 个、5 个十六进制 `0` 开头的哈希，并打印执行耗时。
3. 生成 RSA-2048 和 ECC P-256 公私钥对。
4. 使用私钥签名满足 5 个 `0` 的“昵称 + nonce”。
5. 使用公钥验证原文成功，并验证篡改内容失败。

实现默认使用昵称 `julian`，也可以在命令后传入其他昵称。密钥仅在内存中使用，不会打印或写入磁盘。

## 代码阅读顺序

建议按下面顺序阅读：

1. `run`：了解作业从 PoW 到签名验签的完整流程。
2. `mine`：了解 nonce 如何递增，以及如何判断前导零。
3. `sha256Hex` / `sha256_hex`：了解字符串如何转换为 SHA-256。
4. `rsaRoundTrip` / `rsa_round_trip`：了解 RSA 密钥、签名和验签。
5. `eccRoundTrip` / `ecc_round_trip`：了解 P-256 ECDSA 签名和验签。
6. 对应测试文件：查看如何复算 PoW，并证明篡改消息无法通过验签。

要求 Node.js 20 或更高版本，无第三方依赖。

```bash
cd nodejs
npm test
npm start -- julian
```

## 实际运行结果

以下结果来自同一台机器上的实际运行。PoW 和密码学操作的耗时会受到机器负载影响，每次运行可能不同。

```text
昵称: julian
PoW（4个0）: nonce=2762, hash=0000bbed3ca87fbcffa46941590ad157fee1b68cd70f21939af122e5cd54a927, 耗时=4.355 ms
PoW（5个0）: nonce=1373356, hash=0000004fde54583f1cf15247e7e43327fa97ae98246b23f904cf164b1ea3de86, 耗时=865.176 ms
RSA-2048: 密钥生成=42.201 ms, 签名=1.217 ms, 验签=0.104 ms
RSA-2048: 原文验签=true, 篡改后验签=false
ECC P-256: 密钥生成=0.095 ms, 签名=0.040 ms, 验签=0.139 ms
ECC P-256: 原文验签=true, 篡改后验签=false
```

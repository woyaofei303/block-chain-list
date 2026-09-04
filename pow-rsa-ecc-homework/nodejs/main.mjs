// 阅读顺序：先看 run() 的完整流程，再看 mine()、rsaRoundTrip() 和 eccRoundTrip()。
import {
  constants,
  createHash,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"

function normalizeNickname(nickname) {
  // 命令行参数属于外部输入，先去掉首尾空白并拒绝空昵称。
  const normalized = nickname.trim()
  if (!normalized) throw new Error("昵称不能为空")
  return normalized
}

export function sha256Hex(text) {
  // digest("hex") 把 32 字节摘要转成 64 个十六进制字符，便于检查前导零。
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function mine(nickname, difficulty) {
  // difficulty 表示哈希开头必须连续出现多少个十六进制字符 0。
  const normalized = normalizeNickname(nickname)
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 64) {
    throw new Error("难度必须是 1 到 64 的整数")
  }

  const prefix = "0".repeat(difficulty)
  // performance.now() 使用单调时钟，系统时间被修改也不会影响耗时计算。
  const startedAt = performance.now()

  // nonce 从 0 递增；每次都对“昵称 + nonce”重新计算 SHA-256。
  for (let nonce = 0; nonce <= Number.MAX_SAFE_INTEGER; nonce += 1) {
    const hash = sha256Hex(`${normalized}${nonce}`)
    if (hash.startsWith(prefix)) {
      // 找到后同时返回证明数据和从循环开始到命中的总耗时。
      return { nonce, hash, elapsedMs: performance.now() - startedAt }
    }
  }

  throw new Error("在安全整数范围内没有找到有效 nonce")
}

export function rsaRoundTrip(message) {
  // 密码学 API 接收字节；UTF-8 转换保证中英文昵称都能稳定签名。
  const data = Buffer.from(message, "utf8")
  // 篡改数据
  const dataDif = Buffer.from(`${message}（已篡改）`, "utf8")
  // 生成 RSA-2048 公私钥对，并单独记录密钥生成耗时。
  let startedAt = performance.now()
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
  const keygenMs = performance.now() - startedAt

  // RSA-PSS 使用 SHA-256 摘要，盐长度与摘要长度相同。
  const options = {
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }
  startedAt = performance.now()
  // 私钥生成签名；公钥只能验证，无法生成有效签名。
  const signature = sign("sha256", data, { key: privateKey, ...options })
  const signMs = performance.now() - startedAt

  startedAt = performance.now()
  // 同一签名验证原文应成功，验证被修改的内容必须失败。
  const verified = verify("sha256", data, { key: publicKey, ...options }, signature)
  const tamperedVerified = verify(
    "sha256",
    dataDif, // 篡改数据后验证
    { key: publicKey, ...options },
    signature
  )
  const verifyMs = performance.now() - startedAt

  return { keygenMs, signMs, verifyMs, verified, tamperedVerified }
}

export function eccRoundTrip(message) {
  // ECC 与 RSA 使用同一段消息，便于比较两种算法的耗时和结果。
  const data = Buffer.from(message, "utf8")
  const dataDif = Buffer.from(`${message}（已篡改）`, "utf8")
  // prime256v1 是 Node.js/OpenSSL 对 NIST P-256 曲线的名称。
  let startedAt = performance.now()
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  })
  const keygenMs = performance.now() - startedAt

  startedAt = performance.now()
  // ECDSA 内部先计算 SHA-256，再使用椭圆曲线私钥签名摘要。
  const signature = sign("sha256", data, privateKey)
  const signMs = performance.now() - startedAt

  startedAt = performance.now()
  // 公钥验证签名；验签只判断签名是否匹配，并不是“公钥解密”。
  const verified = verify("sha256", data, publicKey, signature)
  // 篡改后的消息摘要不同，所以不能通过原签名验证。
  const tamperedVerified = verify(
    "sha256",
    dataDif, // 篡改数据后验证
    publicKey,
    signature
  )
  const verifyMs = performance.now() - startedAt

  return { keygenMs, signMs, verifyMs, verified, tamperedVerified }
}

function printSignatureResult(name, result) {
  // 所有耗时统一保留三位小数，以毫秒为单位输出。
  console.log(
    `${name}: 密钥生成=${result.keygenMs.toFixed(3)} ms, ` +
      `签名=${result.signMs.toFixed(3)} ms, 验签=${result.verifyMs.toFixed(3)} ms`
  )
  console.log(
    `${name}: 原文验签=${result.verified}, 篡改后验签=${result.tamperedVerified}`
  )
}

export function run(nickname = "julian") {
  // 主流程依次执行两个难度的 PoW，然后用 5 个零的结果完成签名实验。
  const normalized = normalizeNickname(nickname)
  console.log(`昵称: ${normalized}`)

  const pow4 = mine(normalized, 4)
  console.log(
    `PoW（4个0）: nonce=${pow4.nonce}, hash=${pow4.hash}, 耗时=${pow4.elapsedMs.toFixed(3)} ms`
  )

  const pow5 = mine(normalized, 5)
  console.log(
    `PoW（5个0）: nonce=${pow5.nonce}, hash=${pow5.hash}, 耗时=${pow5.elapsedMs.toFixed(3)} ms`
  )

  // 使用满足 5 个前导零的原始内容完成两种非对称签名实验。
  const message = `${normalized}${pow5.nonce}`
  printSignatureResult("RSA-2048", rsaRoundTrip(message))
  printSignatureResult("ECC P-256", eccRoundTrip(message))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 只有直接执行 main.mjs 时才运行演示；测试导入本文件时不会自动挖矿。
  try {
    run(process.argv[2] ?? "julian")
  } catch (error) {
    console.error(`执行失败: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}

import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"
import { isDeepStrictEqual } from "node:util"

const ZERO_HASH = "0".repeat(64)
const MAX_DIFFICULTY = 6
const TRANSACTION_KEYS = ["id", "from", "to", "amount", "timestamp"]
const BLOCK_KEYS = [
  "index",
  "timestamp",
  "transactions",
  "previousHash",
  "difficulty",
  "nonce",
  "hash",
]

/** 生成固定 64 位十六进制摘要；交易编号和区块编号都使用同一个算法。 */
export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

/** 把演示中的交易双方规范为非空字符串；这里只是名字，没有钱包签名验证。 */
function normalizeParty(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label}必须是非空字符串`)
  }
  return value.trim()
}

/** 校验一条转账记录，并用内容与时间计算编号；这里只记录数据，不检查真实资产余额。 */
export function createTransaction({ from, to, amount }, timestamp = Date.now()) {
  const normalizedFrom = normalizeParty(from, "交易发送方")
  const normalizedTo = normalizeParty(to, "交易接收方")
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TypeError("交易金额必须是大于零的有限数字")
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("交易时间必须是非负安全整数")
  }

  const id = sha256Hex(
    JSON.stringify([normalizedFrom, normalizedTo, amount, timestamp])
  )
  return { id, from: normalizedFrom, to: normalizedTo, amount, timestamp }
}

/** 重新计算编号并比对固定字段，防止别人改了金额却沿用旧编号。 */
function isValidTransaction(transaction) {
  if (!hasExactKeys(transaction, TRANSACTION_KEYS)) return false
  try {
    const recreated = createTransaction(transaction, transaction.timestamp)
    return recreated.id === transaction.id
  } catch {
    return false
  }
}

/** 限制前导零个数为 1～6 的整数，避免传入无效或不适合本演示的难度。 */
function validateDifficulty(difficulty) {
  return (
    Number.isInteger(difficulty) &&
    difficulty >= 1 &&
    difficulty <= MAX_DIFFICULTY
  )
}

/** 按固定字段顺序计算区块哈希；nonce 或交易内容改变，都必须重新挖矿。 */
export function calculateBlockHash(block) {
  // 共识哈希只编码固定顺序的数组，避免对象键顺序影响结果。
  const transactions = block.transactions.map((transaction) => [
    transaction.id,
    transaction.from,
    transaction.to,
    transaction.amount,
    transaction.timestamp,
  ])
  return sha256Hex(
    JSON.stringify([
      block.index,
      block.timestamp,
      transactions,
      block.previousHash,
      block.difficulty,
      block.nonce,
    ])
  )
}

/** 先校验上一块与待打包记录，再不断改变 nonce；返回新区块，但不替调用者接入链。 */
export function mineBlock({ previousBlock, transactions, difficulty, timestamp = Date.now() }) {
  if (!validateDifficulty(difficulty)) {
    throw new RangeError(`挖矿难度必须是 1 到 ${MAX_DIFFICULTY} 的整数`)
  }
  if (
    !isBlockRecord(previousBlock) ||
    !Number.isSafeInteger(previousBlock.index) ||
    previousBlock.index < -1 ||
    !isHash(previousBlock.hash)
  ) {
    throw new TypeError("前一区块索引或哈希无效")
  }
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError("区块时间必须是非负安全整数")
  }
  if (
    previousBlock.index >= 0 &&
    (!Number.isSafeInteger(previousBlock.timestamp) || timestamp < previousBlock.timestamp)
  ) {
    throw new TypeError("区块时间不能早于前一区块")
  }
  if (
    !Array.isArray(transactions) ||
    !transactions.every(isValidTransaction) ||
    new Set(transactions.map((transaction) => transaction.id)).size !== transactions.length
  ) {
    throw new TypeError("区块交易无效")
  }
  const prefix = "0".repeat(difficulty)
  const candidate = {
    index: previousBlock.index + 1,
    timestamp,
    transactions: structuredClone(transactions),
    previousHash: previousBlock.hash,
    difficulty,
    nonce: 0,
    hash: "",
  }
  const startedAt = performance.now()
  do {
    // 递增 nonce，直到哈希满足当前难度要求的前导零。
    candidate.hash = calculateBlockHash(candidate)
    if (candidate.hash.startsWith(prefix)) break
    candidate.nonce += 1
  } while (candidate.nonce <= Number.MAX_SAFE_INTEGER)

  if (!candidate.hash.startsWith(prefix)) throw new Error("nonce 已超出安全整数范围")
  return { block: candidate, elapsedMs: performance.now() - startedAt }
}

const { block: genesisBlock } = mineBlock({
  previousBlock: { index: -1, hash: ZERO_HASH },
  transactions: [],
  difficulty: 1,
  timestamp: 0,
})
Object.freeze(genesisBlock.transactions)
export const GENESIS_BLOCK = Object.freeze(genesisBlock)

/** 排除 null 和数组，后续才把输入当作带字段的记录读取。 */
function isBlockRecord(block) {
  return typeof block === "object" && block !== null && !Array.isArray(block)
}

/** 要求字段不多也不少，避免额外字段形成各节点理解不一致的交易或区块。 */
function hasExactKeys(value, expectedKeys) {
  if (!isBlockRecord(value)) return false
  const keys = Reflect.ownKeys(value)
  return keys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key))
}

/** 只接受本算法输出的 64 位小写十六进制格式，不把任意字符串当成哈希。 */
function isHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
}

/** 逐项检查编号、时间、交易、前块哈希与 PoW，确认它能紧接当前链头。 */
function isValidNextBlock(previousBlock, block) {
  if (!isBlockRecord(previousBlock) || !hasExactKeys(block, BLOCK_KEYS)) return false
  if (!Number.isSafeInteger(block.index) || block.index !== previousBlock.index + 1) return false
  if (!Number.isSafeInteger(block.timestamp) || block.timestamp < previousBlock.timestamp) return false
  if (!Array.isArray(block.transactions) || !block.transactions.every(isValidTransaction)) return false
  if (block.previousHash !== previousBlock.hash) return false
  if (!validateDifficulty(block.difficulty)) return false
  if (!Number.isSafeInteger(block.nonce) || block.nonce < 0) return false
  if (!isHash(block.hash)) return false
  return (
    block.hash === calculateBlockHash(block) &&
    block.hash.startsWith("0".repeat(block.difficulty))
  )
}

/** 从固定创世块开始验证整条链，任何一笔交易都不能在链中重复出现。 */
export function isValidChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return false
  if (!isDeepStrictEqual(chain[0], GENESIS_BLOCK)) return false

  const transactionIds = new Set()
  for (let index = 1; index < chain.length; index += 1) {
    const block = chain[index]
    if (!isValidNextBlock(chain[index - 1], block)) return false
    for (const transaction of block.transactions) {
      if (transactionIds.has(transaction.id)) return false
      transactionIds.add(transaction.id)
    }
  }
  return true
}

/** 对已经验证过的链累计工作量；例如一块难度 2 的贡献相当于 16 块难度 1。 */
export function chainWork(chain) {
  // 每个区块按难度贡献 16 的 difficulty 次方累计工作量。
  return chain.reduce(
    (total, block) => total + 16n ** BigInt(block.difficulty),
    0n
  )
}

/** 收集已经打包的交易编号，供接收交易、接块和清理待打包队列时去重。 */
function transactionIdsInChain(chain) {
  return new Set(
    chain.flatMap((block) => block.transactions.map((transaction) => transaction.id))
  )
}

export class Blockchain {
  /** 每个节点从同一创世块的副本开始，待打包队列为空；实例之间不共享可变数组。 */
  constructor({ difficulty = 4 } = {}) {
    if (!validateDifficulty(difficulty)) {
      throw new RangeError(`挖矿难度必须是 1 到 ${MAX_DIFFICULTY} 的整数`)
    }
    this.difficulty = difficulty
    this.chain = [structuredClone(GENESIS_BLOCK)]
    this.mempool = []
  }

  /** 读取最后一块，即当前链头；挖下一块时用它的编号和哈希作为起点。 */
  get tip() {
    return this.chain.at(-1)
  }

  /** 把 HTTP 送来的原始字段变成带编号的交易，再送入与 P2P 共用的接收入口。 */
  createAndAddTransaction(input) {
    const transaction = createTransaction(input)
    this.addTransaction(transaction)
    return transaction
  }

  /** 校验并暂存尚未出现过的交易；已经打包或已在队列中时返回 false，不重复广播。 */
  addTransaction(transaction) {
    // 本地 HTTP 与远端 P2P 交易共用此入口，确保两条路径遵守相同规则。
    if (!isValidTransaction(transaction)) throw new TypeError("交易内容或 ID 无效")
    const alreadyIncluded = transactionIdsInChain(this.chain).has(transaction.id)
    const alreadyPending = this.mempool.some((item) => item.id === transaction.id)
    if (alreadyIncluded || alreadyPending) return false
    this.mempool.push(structuredClone(transaction))
    return true
  }

  /** 把当前队列打包并接入本地链，再移除已打包记录；挖矿在当前线程同步执行。 */
  minePendingTransactions() {
    const result = mineBlock({
      previousBlock: this.tip,
      transactions: this.mempool,
      difficulty: this.difficulty,
    })
    this.chain.push(result.block)
    const included = new Set(result.block.transactions.map((item) => item.id))
    this.mempool = this.mempool.filter((item) => !included.has(item.id))
    return result
  }

  /** 接收邻居发来的下一块；验证通过才接入，并从待打包队列移除本块包含的交易。 */
  appendBlock(block) {
    if (!isValidNextBlock(this.tip, block)) return false
    const included = transactionIdsInChain(this.chain)
    for (const transaction of block.transactions) {
      if (included.has(transaction.id)) return false
      included.add(transaction.id)
    }
    this.chain.push(structuredClone(block))
    const accepted = new Set(block.transactions.map((transaction) => transaction.id))
    this.mempool = this.mempool.filter((transaction) => !accepted.has(transaction.id))
    return true
  }

  /** 只接受有效且累计工作量更大的整条链；同等工作量不切换，避免反复摇摆。 */
  replaceChain(candidateChain) {
    if (!isValidChain(candidateChain)) return false
    // 仅替换为累计工作量更大的有效链，避免同等或较弱链回滚本地状态。
    if (chainWork(candidateChain) <= chainWork(this.chain)) return false
    // 旧分支已经打包的交易不会自动重新入队；这里只保留原队列中未出现在新链的记录。
    this.chain = structuredClone(candidateChain)
    const included = transactionIdsInChain(this.chain)
    this.mempool = this.mempool.filter((transaction) => !included.has(transaction.id))
    return true
  }
}

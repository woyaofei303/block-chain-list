import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"

const ZERO_HASH = "0".repeat(64)
const MAX_DIFFICULTY = 6

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function normalizeParty(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label}必须是非空字符串`)
  }
  return value.trim()
}

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

function isValidTransaction(transaction) {
  try {
    const recreated = createTransaction(transaction, transaction.timestamp)
    return recreated.id === transaction.id
  } catch {
    return false
  }
}

function validateDifficulty(difficulty) {
  return (
    Number.isInteger(difficulty) &&
    difficulty >= 1 &&
    difficulty <= MAX_DIFFICULTY
  )
}

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

function isBlockRecord(block) {
  return typeof block === "object" && block !== null && !Array.isArray(block)
}

function isHash(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
}

function isValidNextBlock(previousBlock, block) {
  if (!isBlockRecord(previousBlock) || !isBlockRecord(block)) return false
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

export function isValidChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return false
  if (JSON.stringify(chain[0]) !== JSON.stringify(GENESIS_BLOCK)) return false

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

export function chainWork(chain) {
  // 每个区块按难度贡献 16 的 difficulty 次方累计工作量。
  return chain.reduce(
    (total, block) => total + 16n ** BigInt(block.difficulty),
    0n
  )
}

function transactionIdsInChain(chain) {
  return new Set(
    chain.flatMap((block) => block.transactions.map((transaction) => transaction.id))
  )
}

export class Blockchain {
  constructor({ difficulty = 4 } = {}) {
    if (!validateDifficulty(difficulty)) {
      throw new RangeError(`挖矿难度必须是 1 到 ${MAX_DIFFICULTY} 的整数`)
    }
    this.difficulty = difficulty
    this.chain = [structuredClone(GENESIS_BLOCK)]
    this.mempool = []
  }

  get tip() {
    return this.chain.at(-1)
  }

  createAndAddTransaction(input) {
    const transaction = createTransaction(input)
    this.addTransaction(transaction)
    return transaction
  }

  addTransaction(transaction) {
    if (!isValidTransaction(transaction)) throw new TypeError("交易内容或 ID 无效")
    const alreadyIncluded = transactionIdsInChain(this.chain).has(transaction.id)
    const alreadyPending = this.mempool.some((item) => item.id === transaction.id)
    if (alreadyIncluded || alreadyPending) return false
    this.mempool.push(structuredClone(transaction))
    return true
  }

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

  replaceChain(candidateChain) {
    if (!isValidChain(candidateChain)) return false
    // 仅替换为累计工作量更大的有效链，避免同等或较弱链回滚本地状态。
    if (chainWork(candidateChain) <= chainWork(this.chain)) return false
    this.chain = structuredClone(candidateChain)
    const included = transactionIdsInChain(this.chain)
    this.mempool = this.mempool.filter((transaction) => !included.has(transaction.id))
    return true
  }
}

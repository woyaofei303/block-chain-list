import assert from "node:assert/strict"
import test from "node:test"
import {
  Blockchain,
  calculateBlockHash,
  chainWork,
  createTransaction,
  GENESIS_BLOCK,
  isValidChain,
  mineBlock,
  sha256Hex,
} from "../src/blockchain.mjs"

test("SHA-256 和交易 ID 是确定的", () => {
  assert.equal(
    sha256Hex("blockchain"),
    "ef7797e13d3a75526946a3bcf00daec9fc9c9c4d51ddc7cc5df888f74dd434d1"
  )
  assert.deepEqual(
    createTransaction({ from: "alice", to: "bob", amount: 10 }, 1),
    createTransaction({ from: "alice", to: "bob", amount: 10 }, 1)
  )
})

test("PoW 将待处理交易打包进有效区块", () => {
  const blockchain = new Blockchain({ difficulty: 1 })
  const transaction = blockchain.createAndAddTransaction({
    from: "alice",
    to: "bob",
    amount: 10,
  })

  const { block, elapsedMs } = blockchain.minePendingTransactions()

  assert.equal(block.transactions[0].id, transaction.id)
  assert.match(block.hash, /^0/)
  assert.equal(block.hash, calculateBlockHash(block))
  assert.equal(blockchain.mempool.length, 0)
  assert.equal(isValidChain(blockchain.chain), true)
  assert.ok(elapsedMs >= 0)
})

test("篡改已入块交易会破坏整条链", () => {
  const blockchain = new Blockchain({ difficulty: 1 })
  blockchain.createAndAddTransaction({ from: "alice", to: "bob", amount: 10 })
  blockchain.minePendingTransactions()

  const tampered = structuredClone(blockchain.chain)
  tampered[1].transactions[0].amount = 999

  assert.equal(isValidChain(tampered), false)
})

test("只采用累计工作量更大的有效链", () => {
  const local = new Blockchain({ difficulty: 1 })
  const remote = new Blockchain({ difficulty: 1 })
  remote.createAndAddTransaction({ from: "alice", to: "bob", amount: 1 })
  remote.minePendingTransactions()

  assert.ok(chainWork(remote.chain) > chainWork(local.chain))
  assert.equal(local.replaceChain(remote.chain), true)
  assert.equal(local.chain.at(-1).hash, remote.chain.at(-1).hash)

  const invalid = structuredClone(remote.chain)
  invalid[1].previousHash = "f".repeat(64)
  assert.equal(local.replaceChain(invalid), false)
})

test("拒绝无效交易并对重复交易去重", () => {
  const blockchain = new Blockchain({ difficulty: 1 })
  assert.throws(
    () => blockchain.createAndAddTransaction({ from: "alice", to: "", amount: 1 }),
    /交易接收方/
  )
  assert.throws(
    () => blockchain.createAndAddTransaction({ from: "alice", to: "bob", amount: 0 }),
    /交易金额/
  )

  const transaction = createTransaction({ from: "alice", to: "bob", amount: 1 }, 1)
  assert.equal(blockchain.addTransaction(transaction), true)
  assert.equal(blockchain.addTransaction(transaction), false)
})

test("拒绝包含重复交易的外来区块", () => {
  const blockchain = new Blockchain({ difficulty: 1 })
  const transaction = createTransaction({ from: "alice", to: "bob", amount: 1 }, 1)
  const block = {
    index: blockchain.tip.index + 1,
    timestamp: 1,
    transactions: [transaction, transaction],
    previousHash: blockchain.tip.hash,
    difficulty: 1,
    nonce: 0,
    hash: "",
  }
  do {
    block.hash = calculateBlockHash(block)
    if (!block.hash.startsWith("0")) block.nonce += 1
  } while (!block.hash.startsWith("0"))

  assert.equal(blockchain.appendBlock(block), false)
  assert.equal(blockchain.chain.length, 1)
  assert.throws(
    () => mineBlock({
      previousBlock: blockchain.tip,
      transactions: [transaction, transaction],
      difficulty: 1,
      timestamp: 1,
    }),
    /交易/
  )
})

test("公开链入口拒绝畸形区块", () => {
  const blockchain = new Blockchain({ difficulty: 1 })

  assert.equal(blockchain.appendBlock(null), false)
  assert.equal(blockchain.replaceChain([structuredClone(GENESIS_BLOCK), null]), false)
})

test("创世块和矿工输入保持可验证", () => {
  assert.throws(() => GENESIS_BLOCK.transactions.push({}), TypeError)

  assert.throws(
    () => mineBlock({
      previousBlock: { index: 0, hash: "invalid" },
      transactions: [],
      difficulty: 1,
      timestamp: -1,
    }),
    /前一区块|区块时间/
  )
  assert.throws(
    () => mineBlock({
      previousBlock: GENESIS_BLOCK,
      transactions: [createTransaction({ from: "alice", to: "bob", amount: 1 }, 1), {}],
      difficulty: 1,
      timestamp: 1,
    }),
    /交易/
  )
})

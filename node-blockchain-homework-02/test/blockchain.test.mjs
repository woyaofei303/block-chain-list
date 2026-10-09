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

// 固定同一笔交易的字段和时间，检查哈希可复算，不能依赖对象创建时的偶然顺序。
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

// 先把交易放进内存池再挖矿，检查交易确实进入有效区块且待处理项被移走。
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

// 复制已确认区块后改金额，验证哈希链会识别历史被篡改。
test("篡改已入块交易会破坏整条链", () => {
  const blockchain = new Blockchain({ difficulty: 1 })
  blockchain.createAndAddTransaction({ from: "alice", to: "bob", amount: 10 })
  blockchain.minePendingTransactions()

  const tampered = structuredClone(blockchain.chain)
  tampered[1].transactions[0].amount = 999

  assert.equal(isValidChain(tampered), false)
})

// 构造更短但难度更高的链，说明选链比较的是累计工作量，而不只是区块数量。
test("只采用累计工作量更大的有效链", () => {
  const local = new Blockchain({ difficulty: 1 })
  local.minePendingTransactions()
  local.minePendingTransactions()
  const remote = new Blockchain({ difficulty: 2 })
  remote.createAndAddTransaction({ from: "alice", to: "bob", amount: 1 })
  remote.minePendingTransactions()

  assert.ok(remote.chain.length < local.chain.length)
  assert.ok(chainWork(remote.chain) > chainWork(local.chain))
  assert.equal(local.replaceChain(remote.chain), true)
  assert.equal(local.chain.at(-1).hash, remote.chain.at(-1).hash)

  const invalid = structuredClone(remote.chain)
  invalid[1].previousHash = "f".repeat(64)
  assert.equal(local.replaceChain(invalid), false)
})

// 给外部交易和区块塞入额外字段，检查接收边界不会静默忽略歧义数据。
test("拒绝交易或普通区块中的未知字段", () => {
  const blockchain = new Blockchain({ difficulty: 1 })
  const transaction = createTransaction({ from: "alice", to: "bob", amount: 1 }, 1)
  const { block } = mineBlock({
    previousBlock: blockchain.tip,
    transactions: [transaction],
    difficulty: 1,
    timestamp: 1,
  })

  assert.throws(() => blockchain.addTransaction({ ...transaction, memo: "未参与 ID" }), /交易/)
  assert.equal(blockchain.appendBlock({ ...block, note: "未参与哈希" }), false)
  const transactionTampered = structuredClone(block)
  transactionTampered.transactions[0].memo = "未参与哈希"
  assert.equal(blockchain.appendBlock(transactionTampered), false)
})

// 重排创世块对象的字段顺序，验证语义一致的数据不会只因 JSON 排序而被拒绝。
test("创世块字段顺序不影响语义校验", () => {
  const reorderedGenesis = Object.fromEntries(Object.entries(GENESIS_BLOCK).reverse())

  assert.equal(isValidChain([reorderedGenesis]), true)
})

// 混入非法金额并重复提交同一交易，检查内存池只保留可验证的唯一记录。
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

// 外部区块重复使用同一交易，接收时必须拒绝，不能只检查区块自身哈希。
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

// 向公开入口传入非预期形状的数据，检查节点返回拒绝而不是被异常击穿。
test("公开链入口拒绝畸形区块", () => {
  const blockchain = new Blockchain({ difficulty: 1 })

  assert.equal(blockchain.appendBlock(null), false)
  assert.equal(blockchain.replaceChain([structuredClone(GENESIS_BLOCK), null]), false)
})

// 从构造和矿工输入处检查约束，确保本节点产出的块也能通过其他节点校验。
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
      previousBlock: { index: 0, timestamp: 10, hash: "0".repeat(64) },
      transactions: [],
      difficulty: 1,
      timestamp: 9,
    }),
    /区块时间不能早于前一区块/
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

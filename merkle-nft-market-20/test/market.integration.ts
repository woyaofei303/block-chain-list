import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'
import {
  createPublicClient,
  createWalletClient,
  getContractAddress,
  http,
  parseEther,
} from 'viem'
import { anvil } from 'viem/chains'
import { runDemo } from '../script/demo.ts'
import { marketAbi } from '../src/client.ts'
import { buildMerkleTree } from '../src/merkle.ts'

const execute = promisify(execFile)

// 独立 RPC 验证真实部署、奇数叶 Merkle 证明、钱包签名、客户端编码与一笔成交，结束释放节点。
test('forge script deployment and TypeScript permit/multicall purchase on Anvil', {
  timeout: 120_000,
}, async (t) => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  const rpcUrl = `http://127.0.0.1:${address.port}`
  // 静默启动避免 Anvil 打印测试私钥；仅清理本测试创建的进程。
  const process = spawn(
    'anvil',
    ['--host', '127.0.0.1', '--port', String(address.port), '--silent'],
    { stdio: 'ignore' },
  )
  let spawnError: Error | undefined
  process.on('error', (error) => {
    spawnError = error
  })
  t.after(async () => {
    if (
      process.exitCode === null &&
      process.signalCode === null &&
      !spawnError
    ) {
      const exited = once(process, 'exit')
      process.kill('SIGTERM')
      await exited
    }
  })
  const publicClient = createPublicClient({
    chain: anvil,
    transport: http(rpcUrl, { retryCount: 0, timeout: 500 }),
  })
  const wallet = createWalletClient({ chain: anvil, transport: http(rpcUrl) })
  for (let attempt = 0; ; attempt++) {
    if (spawnError) throw spawnError
    try {
      assert.equal(await publicClient.getChainId(), 31337)
      break
    } catch (error) {
      if (attempt >= 99 || process.exitCode !== null) throw error
      await setTimeout(50)
    }
  }
  const accounts = await wallet.getAddresses()
  const seller = accounts[0]
  const tree = buildMerkleTree(accounts.slice(1, 4))
  const args = [
    'script',
    'script/Deploy.s.sol:Deploy',
    '--sig',
    'run(address,bytes32)',
    seller,
    tree.root,
    '--sender',
    seller,
    '--rpc-url',
    rpcUrl,
  ]
  await execute('forge', args, { timeout: 60_000 })
  assert.equal(
    await publicClient.getTransactionCount({ address: seller }),
    0,
    '模拟不得广播交易',
  )
  // 脚本顺序部署三个合约，第三个 CREATE 使用部署者 nonce 2。
  const market = getContractAddress({ from: seller, nonce: 2n })
  await execute('forge', [...args, '--unlocked', '--broadcast', '--slow'], {
    timeout: 60_000,
  })
  assert.notEqual(await publicClient.getCode({ address: market }), undefined)
  for (const entry of tree.entries) {
    assert.equal(
      await publicClient.readContract({
        address: market,
        abi: marketAbi,
        functionName: 'isWhitelisted',
        args: [entry.address, entry.proof],
      }),
      true,
    )
  }
  assert.equal(
    await publicClient.readContract({
      address: market,
      abi: marketAbi,
      functionName: 'isWhitelisted',
      args: [seller, tree.entries[0].proof],
    }),
    false,
  )
  assert.equal(
    await publicClient.readContract({
      address: market,
      abi: marketAbi,
      functionName: 'isWhitelisted',
      args: [accounts[1], []],
    }),
    false,
  )

  const report = await runDemo(rpcUrl, market)
  assert.equal(report.after.buyer, parseEther('50'))
  assert.equal(
    await publicClient.getTransactionCount({ address: accounts[1] }),
    1,
    '买家只能发送一笔购买交易',
  )
  // 重复演示必须在任何新写入前拒绝，避免产生额外铸造或转账。
  const sellerNonce = await publicClient.getTransactionCount({
    address: seller,
  })
  await assert.rejects(runDemo(rpcUrl, market), /全新部署/)
  assert.equal(
    await publicClient.getTransactionCount({ address: seller }),
    sellerNonce,
  )
  console.log(
    JSON.stringify(report, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  )
})

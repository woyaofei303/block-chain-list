import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { promisify } from 'node:util'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getContractAddress,
  http,
  parseEther,
} from 'viem'
import { anvil } from 'viem/chains'
import { runDemo } from '../script/demo.ts'
import { marketAbi, nftAbi, preparePurchase, tokenAbi } from '../src/client.ts'
import { buildMerkleTree } from '../src/merkle.ts'

const execute = promisify(execFile)

// 独立 RPC 验证真实部署、奇数叶 Merkle 证明、钱包签名、客户端编码与一笔成交，结束释放节点。
test('forge script deployment and TypeScript permit/multicall purchase on Anvil', {
  timeout: 180_000,
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
    [
      '--host',
      '127.0.0.1',
      '--port',
      String(address.port),
      '--hardfork',
      'cancun',
      '--silent',
    ],
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
    pollingInterval: 50,
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

  const buyer = accounts[1]
  const proof = tree.entries[0].proof
  const control = createTestClient({
    chain: anvil,
    mode: 'anvil',
    transport: http(rpcUrl),
  })
  /** 等待实际回执，准备交易与被测购买分开统计，失败不能当作节省 Gas。 */
  async function confirmed(hash: `0x${string}`) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    assert.equal(receipt.status, 'success')
    return receipt.gasUsed
  }
  /** 读取实际额度后选择旧合约已有入口；每项预算精确为 50 Token，不部署新合约。 */
  async function purchase(ids: readonly bigint[]) {
    const call = await preparePurchase({
      publicClient,
      wallet,
      buyer,
      market,
      proof,
      // 每件商品独立携带最高价，链上仍逐项验证价格及 proof。
      items: ids.map((tokenId) => ({ tokenId, maxPayment: parseEther('50') })),
    })
    return confirmed(await wallet.sendTransaction({ account: buyer, ...call }))
  }

  await confirmed(
    await wallet.writeContract({
      account: seller,
      address: report.token,
      abi: tokenAbi,
      functionName: 'transfer',
      args: [buyer, parseEther('10000')],
    }),
  )
  let initialSnapshot = await control.snapshot()
  const gasRows: Record<string, string | number>[] = []
  for (const count of [1, 5, 10]) {
    // 每一行也恢复相同资产余额与 Permit nonce，避免前一行预先写入存储的干扰。
    await control.revert({ id: initialSnapshot })
    initialSnapshot = await control.snapshot()
    const ids: bigint[] = []
    for (let i = 0; i < count; ++i) {
      const id = await publicClient.readContract({
        address: report.nft,
        abi: nftAbi,
        functionName: 'nextTokenId',
      })
      ids.push(id)
      await confirmed(
        await wallet.writeContract({
          account: seller,
          address: report.nft,
          abi: nftAbi,
          functionName: 'mint',
          args: [seller],
        }),
      )
      await confirmed(
        await wallet.writeContract({
          account: seller,
          address: report.nft,
          abi: nftAbi,
          functionName: 'approve',
          args: [market, id],
        }),
      )
      await confirmed(
        await wallet.writeContract({
          account: seller,
          address: market,
          abi: marketAbi,
          functionName: 'list',
          args: [id, parseEther('100')],
        }),
      )
    }
    let snapshot = await control.snapshot()
    let separate = 0n
    for (const id of ids) separate += await purchase([id])
    await control.revert({ id: snapshot })
    snapshot = await control.snapshot()
    const nonceBefore = await publicClient.readContract({
      address: report.token,
      abi: tokenAbi,
      functionName: 'nonces',
      args: [buyer],
    })
    const balanceBefore = await publicClient.readContract({
      address: report.token,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [buyer],
    })
    const sharedPermit = await purchase(ids)
    if (count > 1) assert.ok(sharedPermit < separate)
    else assert.equal(sharedPermit, separate)
    assert.equal(
      await publicClient.readContract({
        address: report.token,
        abi: tokenAbi,
        functionName: 'nonces',
        args: [buyer],
      }),
      nonceBefore + 1n,
    )
    assert.equal(
      await publicClient.readContract({
        address: report.token,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [buyer],
      }),
      balanceBefore - BigInt(count) * parseEther('50'),
    )
    for (const id of ids)
      assert.equal(
        await publicClient.readContract({
          address: report.nft,
          abi: nftAbi,
          functionName: 'ownerOf',
          args: [id],
        }),
        buyer,
      )
    await control.revert({ id: snapshot })
    const approvalGas = await confirmed(
      await wallet.writeContract({
        account: buyer,
        address: report.token,
        abi: tokenAbi,
        functionName: 'approve',
        args: [market, BigInt(count) * parseEther('50')],
      }),
    )
    const existingAllowance = await purchase(ids)
    assert.ok(existingAllowance < sharedPermit)
    assert.equal(
      await publicClient.readContract({
        address: report.token,
        abi: tokenAbi,
        functionName: 'nonces',
        args: [buyer],
      }),
      nonceBefore,
    )
    assert.equal(
      await publicClient.readContract({
        address: report.token,
        abi: tokenAbi,
        functionName: 'allowance',
        args: [buyer, market],
      }),
      0n,
    )
    gasRows.push({
      count,
      separate: String(separate),
      sharedPermit: String(sharedPermit),
      existingAllowance: String(existingAllowance),
      approvalGas: String(approvalGas),
    })
  }
  console.log(JSON.stringify({ clientOnlyGas: gasRows }))
})

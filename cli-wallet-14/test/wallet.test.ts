import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  FeeData,
  JsonRpcProvider,
  MaxUint256,
  Network,
  Transaction,
  ZeroAddress,
} from 'ethers'
import {
  address,
  amount,
  broadcast,
  buildTransfer,
  CHAIN_ID,
  connect,
  createWallet,
  erc20,
  InputError,
  safeError,
  signTransfer,
  walletAddress,
} from '../src/wallet.ts'

const token = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'

test('输入边界：精度、金额、地址、RPC 和错误脱敏', () => {
  assert.equal(amount('1.000001', 6), 1000001n)
  assert.equal(
    amount('9007199254740993.000000000000000001', 18),
    9007199254740993000000000000000001n,
  )
  assert.equal(amount('1', 0), 1n)
  assert.equal(amount(MaxUint256.toString(), 0), MaxUint256)
  for (const value of ['0', '-1', '1e3', ' 1', '+1', '01', '1.0000001', '1.']) {
    assert.throws(() => amount(value, 6), InputError)
  }
  assert.throws(() => amount((MaxUint256 + 1n).toString(), 0), InputError)
  assert.throws(() => amount('1', 256), InputError)
  for (const value of [ZeroAddress, 'alice.eth', '0x123'])
    assert.throws(() => address(value), InputError)
  for (const value of [undefined, 'not-a-url', 'file:///secret'])
    assert.throws(() => connect(value), InputError)
  assert(
    !safeError(new Error('https://private.example/token-secret')).includes(
      'token-secret',
    ),
  )
  assert.match(safeError({ code: 'EEXIST' }), /未覆盖/)
})

test('加密钱包 → 构建 ERC20 type 2 → 签名恢复 → 广播前日志及失败状态', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cli-wallet-test-'))
  const file = join(directory, 'keystore.json')
  const provider = new JsonRpcProvider('http://127.0.0.1:1')
  t.after(async () => {
    provider.destroy()
    await rm(directory, { recursive: true, force: true })
  })
  const state = {
    chainId: CHAIN_ID,
    code: '0x1234',
    decimals: 6,
    balance: 10000000n,
    eth: 10n ** 18n,
    nonce: 7,
    transferOk: true,
  }
  t.mock.method(provider, 'getNetwork', async () =>
    Network.from(Number(state.chainId)),
  )
  t.mock.method(provider, 'getCode', async () => state.code)
  t.mock.method(provider, 'getBalance', async () => state.eth)
  t.mock.method(
    provider,
    'getTransactionCount',
    async (_owner: unknown, block: unknown) => {
      assert.equal(block, 'pending')
      return state.nonce
    },
  )
  t.mock.method(
    provider,
    'getFeeData',
    async () => new FeeData(null, 3000000000n, 1000000000n),
  )
  t.mock.method(provider, 'estimateGas', async () => 50001n)
  t.mock.method(
    provider,
    'call',
    async (tx: { data: string; gasLimit?: bigint; maxFeePerGas?: bigint }) => {
      const call = erc20.parseTransaction({ data: tx.data })
      assert(call)
      if (call.name === 'decimals')
        return erc20.encodeFunctionResult('decimals', [state.decimals])
      if (call.name === 'balanceOf')
        return erc20.encodeFunctionResult('balanceOf', [state.balance])
      assert.equal(call.name, 'transfer')
      // 复现 Sepolia RPC：eth_call 不带 gas 时使用 uint64 最大值检查费用。
      if (
        (tx.gasLimit ?? 2n ** 64n - 1n) * (tx.maxFeePerGas ?? 0n) >
        state.eth
      ) {
        throw new Error('insufficient funds for gas * price + value')
      }
      return erc20.encodeFunctionResult('transfer', [state.transferOk])
    },
  )
  const send = t.mock.method(provider, 'broadcastTransaction', async () => {
    throw new Error('simulated RPC timeout')
  })
  const password = 'disposable-test-password'
  await assert.rejects(createWallet(file, 'short'), /至少/)
  const owner = await createWallet(file, password)
  assert.equal(await walletAddress(file), owner)
  const original = await readFile(file, 'utf8')
  assert(!original.includes('privateKey'))
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  await assert.rejects(createWallet(file, password), { code: 'EEXIST' })
  assert.equal(await readFile(file, 'utf8'), original)

  const input = {
    from: owner,
    token,
    to: recipient,
    amount: '1.25',
    maxFee: '20',
  }
  const prepared = await buildTransfer(provider, input)
  assert.equal(prepared.transaction.type, 2)
  assert.equal(prepared.transaction.chainId, CHAIN_ID)
  assert.equal(prepared.transaction.to, token)
  assert.equal(prepared.transaction.value, 0n)
  assert.equal(prepared.transaction.nonce, 7)
  assert.equal(prepared.transaction.gasLimit, 60002n)
  assert.equal(prepared.maxCost, 60002n * 20000000000n)
  assert.equal(prepared.units, 1250000n)
  assert.deepEqual(
    [...erc20.decodeFunctionData('transfer', prepared.transaction.data)],
    [recipient, 1250000n],
  )
  assert.equal(send.mock.callCount(), 0)
  await assert.rejects(
    signTransfer(file, 'incorrect-password', prepared.transaction),
    /无法解锁/,
  )
  const { signed, hash } = await signTransfer(
    file,
    password,
    prepared.transaction,
  )
  const recovered = Transaction.from(signed)
  assert(signed.startsWith('0x02'))
  assert.equal(recovered.from, owner)
  assert.equal(recovered.hash, hash)
  assert.equal(recovered.chainId, CHAIN_ID)
  assert.equal(recovered.maxFeePerGas, 20000000000n)
  assert.equal(recovered.maxPriorityFeePerGas, 1000000000n)
  assert.equal(recovered.data, prepared.transaction.data)
  await assert.rejects(
    signTransfer(file, password, { ...prepared.transaction, chainId: 1n }),
    /Sepolia/,
  )
  await assert.rejects(
    signTransfer(file, password, { ...prepared.transaction, from: recipient }),
    /不一致/,
  )

  state.chainId = 1n
  await assert.rejects(buildTransfer(provider, input), /网络错误/)
  state.chainId = CHAIN_ID
  state.code = '0x'
  await assert.rejects(buildTransfer(provider, input), /没有合约/)
  state.code = '0x1234'
  state.balance = 1n
  await assert.rejects(buildTransfer(provider, input), /ERC20 余额不足/)
  state.balance = 10000000n
  state.eth = 0n
  await assert.rejects(buildTransfer(provider, input), /ETH 不足/)
  state.eth = 10n ** 18n
  state.transferOk = false
  await assert.rejects(buildTransfer(provider, input), /返回 false/)
  state.transferOk = true
  await assert.rejects(
    buildTransfer(provider, { ...input, maxFee: '0.1' }),
    /低于建议小费/,
  )
  for (const decimals of [0, 18]) {
    state.decimals = decimals
    state.balance = 100n * 10n ** BigInt(decimals)
    assert.equal(
      (await buildTransfer(provider, { ...input, amount: '1' })).units,
      10n ** BigInt(decimals),
    )
  }
  state.nonce = 8
  const record = join(directory, `${hash}.json`)
  await assert.rejects(broadcast(provider, signed, record), /nonce 已变化/)
  assert.equal(send.mock.callCount(), 0)
  state.nonce = 7
  await assert.rejects(
    broadcast(provider, signed, record),
    /simulated RPC timeout/,
  )
  assert.equal(send.mock.callCount(), 1)
  const saved = await readFile(record, 'utf8')
  assert.equal(JSON.parse(saved).hash, hash)
  assert(!saved.includes(signed))
  await assert.rejects(broadcast(provider, signed, record), { code: 'EEXIST' })
  assert.equal(send.mock.callCount(), 1)
})

test('CLI 帮助、非法参数和非交互创建', () => {
  const cli = new URL('../src/cli.ts', import.meta.url).pathname
  assert.match(
    execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }),
    /--send/,
  )
  for (const args of [
    ['create'],
    ['create', '--send'],
    ['transfer', '--private-key', 'do-not-print-this'],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert(!result.stderr.includes('do-not-print-this'))
  }
})

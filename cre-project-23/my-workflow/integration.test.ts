import { expect, setDefaultTimeout } from 'bun:test'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { protoBigIntToBigint } from '@chainlink/cre-sdk'
import {
  EvmMock,
  newTestRuntime,
  REPORT_METADATA_HEADER_LENGTH,
  test,
} from '@chainlink/cre-sdk/test'
import { bytesToHex, getAddress, hexToBytes, isAddress, isHex } from 'viem'
import { z } from 'zod'
import { configSchema, onCronTrigger } from './workflow'

setDefaultTimeout(120000)
const root = resolve(import.meta.dir, '../..')
const artifacts = resolve(root, 'output-tdd/tokenbank-cre')
const addressSchema = z
  .string()
  .refine(isAddress)
  .transform((value) => getAddress(value))
const receiptSchema = z.object({
  status: z.literal('0x1'),
  transactionHash: z.string().refine(isHex),
})

/** 执行无 shell 插值的本地命令，检查退出码；只传本地 RPC 和公开账户地址。 */
function command(file: string, args: string[]): string {
  return execFileSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 45000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** 由 OS 分配空闲 loopback 端口，失败时不接管已有节点。 */
async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Missing TCP address')
  const port = address.port
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  )
  return port
}

/** 真实运行 CRE Cron 回调；只把 DON/签名能力换成本地模拟，合约读取和写入走独立 Anvil。 */
test('CRE callback → real Anvil Receiver → TokenBank balances', async () => {
  const port = await freePort()
  const rpc = `http://127.0.0.1:${port}`
  const anvil = spawn(
    'anvil',
    [
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--chain-id',
      '31337',
      '--silent',
    ],
    {
      // Anvil 启动信息可能含测试私钥，丢弃所有输出。
      stdio: 'ignore',
    },
  )
  const stopped = once(anvil, 'exit')
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (anvil.exitCode !== null) throw new Error('Owned Anvil exited')
      try {
        ready = command('cast', ['chain-id', '--rpc-url', rpc]) === '31337'
        if (ready) break
      } catch {
        /* 仅在自己的节点初始化期间重试。 */
      }
      await Bun.sleep(100)
    }
    if (!ready) throw new Error('Anvil readiness timeout')
    const accounts = z
      .array(addressSchema)
      .min(3)
      .parse(
        JSON.parse(command('cast', ['rpc', '--rpc-url', rpc, 'eth_accounts'])),
      )
    const [deployer, forwarder, recipient] = accounts
    if (!deployer || !forwarder || !recipient)
      throw new Error('Missing unlocked accounts')
    const deployArgs = [
      'script',
      'cre-project-23/contracts/script/DeployLocal.s.sol:DeployLocalScript',
      '--root',
      'cre-project-23/contracts',
      '--sig',
      'run(address,address)',
      forwarder,
      recipient,
      '--rpc-url',
      rpc,
      '--sender',
      deployer,
      '--unlocked',
    ]
    writeFileSync(
      resolve(artifacts, 'deploy-dry-run.log'),
      command('forge', deployArgs),
    )
    writeFileSync(
      resolve(artifacts, 'deploy-anvil.log'),
      command('forge', [...deployArgs, '--broadcast']),
    )
    const deployment = z
      .object({
        transactions: z.array(
          z.object({
            contractName: z.string().nullable(),
            contractAddress: addressSchema.nullable(),
          }),
        ),
      })
      .parse(
        JSON.parse(
          readFileSync(
            resolve(
              artifacts,
              'broadcast/DeployLocal.s.sol/31337/run-latest.json',
            ),
            'utf8',
          ),
        ),
      )
    /** 从本轮实际部署记录取地址，缺失时终止，避免使用历史部署。 */
    const deployed = (name: string) => {
      const value = deployment.transactions.find(
        (tx) => tx.contractName === name,
      )?.contractAddress
      if (!value) throw new Error(`Missing deployment: ${name}`)
      return value
    }
    const token = deployed('BaseERC20')
    const bank = deployed('TokenBank')
    const receiver = deployed('TokenBankReceiver')
    const amounts = {
      hundred: '100000000000000000000',
      twenty: '20000000000000000000',
    }
    /** 用 Anvil 解锁账户发送交易；检查回执状态，不处理私钥。 */
    const send = (
      from: string,
      to: string,
      signature: string,
      ...args: string[]
    ) =>
      receiptSchema.parse(
        JSON.parse(
          command('cast', [
            'send',
            '--rpc-url',
            rpc,
            '--unlocked',
            '--from',
            from,
            '--json',
            to,
            signature,
            ...args,
          ]),
        ),
      )
    /** 查询真实 EVM uint 值，保留完整整数精度。 */
    const readUint = (to: string, signature: string, ...args: string[]) =>
      BigInt(
        command('cast', [
          'call',
          '--rpc-url',
          rpc,
          to,
          signature,
          ...args,
        ]).split(' ')[0] ?? '',
      )
    const evm = EvmMock.testInstance(16015286601757825753n)
    /** SDK callContract 原封不动转发到实际 Receiver，错误 ABI 会直接使测试失败。 */
    evm.callContract = (request) => {
      if (!request.call) throw new Error('Missing EVM call')
      if (!request.blockNumber) throw new Error('Missing block number')
      // SDK 的 -3 表示 finalized；不能在适配器中悄悄改成 latest。
      expect(protoBigIntToBigint(request.blockNumber)).toBe(-3n)
      const data = command('cast', [
        'call',
        '--rpc-url',
        rpc,
        '--block',
        'finalized',
        bytesToHex(request.call.to),
        '--data',
        bytesToHex(request.call.data),
      ])
      if (!isHex(data)) throw new Error('Invalid eth_call result')
      return { data: Buffer.from(hexToBytes(data)).toString('base64') }
    }
    let writes = 0
    let lastPayload = '0x'
    /** 代替 DON Forwarder 发送本地报告；回执和余额是实际 Anvil 数据。 */
    evm.writeReport = (request) => {
      if (!request.report) throw new Error('Missing report')
      lastPayload = bytesToHex(
        request.report.rawReport.slice(REPORT_METADATA_HEADER_LENGTH),
      )
      const receipt = send(
        forwarder,
        bytesToHex(request.receiver),
        'onReport(bytes,bytes)',
        '0x',
        lastPayload,
      )
      writes++
      console.log(`ANVIL report tx=${receipt.transactionHash}`)
      return {
        txStatus: 'TX_STATUS_SUCCESS',
        receiverContractExecutionStatus:
          'RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS',
        txHash: Buffer.from(hexToBytes(receipt.transactionHash)).toString(
          'base64',
        ),
      }
    }
    const runtime = newTestRuntime(
      undefined,
      {},
      configSchema.parse({
        schedule: '0 */5 * * * *',
        evms: [
          {
            chainSelectorName: 'ethereum-testnet-sepolia',
            contractAddress: receiver,
          },
        ],
      }),
    )
    send(
      deployer,
      token,
      'approve(address,uint256)',
      bank,
      '120000000000000000000',
    )
    send(deployer, bank, 'deposit(uint256)', amounts.hundred)
    // Anvil 的 finalized 落后 latest；挖空块让本次存款进入工作流实际读取的区块。
    command('cast', ['rpc', '--rpc-url', rpc, 'anvil_mine', '0x40'])
    expect(onCronTrigger(runtime)).toBe('Skipped')
    console.log('ANVIL deposits=100 threshold=100 → skipped, writes=0')
    send(deployer, bank, 'deposit(uint256)', amounts.twenty)
    command('cast', ['rpc', '--rpc-url', rpc, 'anvil_mine', '0x40'])
    expect(onCronTrigger(runtime)).toStartWith('Executed: 0x')
    expect(readUint(token, 'balanceOf(address)(uint256)', recipient)).toBe(
      60n * 10n ** 18n,
    )
    expect(readUint(token, 'balanceOf(address)(uint256)', bank)).toBe(
      60n * 10n ** 18n,
    )
    expect(readUint(bank, 'balances(address)(uint256)', deployer)).toBe(
      60n * 10n ** 18n,
    )
    console.log(
      'ANVIL deposits=120 → recipient=60 bank=60 userClaim=60 nonce=2',
    )
    expect(() =>
      send(forwarder, receiver, 'onReport(bytes,bytes)', '0x', lastPayload),
    ).toThrow()
    command('cast', ['rpc', '--rpc-url', rpc, 'anvil_mine', '0x40'])
    expect(onCronTrigger(runtime)).toBe('Skipped')
    expect(writes).toBe(1)
    send(deployer, bank, 'withdraw(uint256)', '60000000000000000000')
    expect(readUint(bank, 'totalDeposits()(uint256)')).toBe(0n)
    expect(readUint(token, 'balanceOf(address)(uint256)', bank)).toBe(0n)
    console.log(
      'ANVIL replay rejected; next tick skipped; user withdrew remaining 60; bank=0',
    )
    console.log(runtime.getLogs().join('\n'))
  } finally {
    // 只关闭本测试创建的节点，等待退出后返回。
    anvil.kill('SIGTERM')
    await stopped
  }
})

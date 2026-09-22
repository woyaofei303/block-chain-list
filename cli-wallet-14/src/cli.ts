import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { formatEther, formatUnits, type JsonRpcProvider } from 'ethers'
import {
  address,
  assertSepolia,
  broadcast,
  buildTransfer,
  connect,
  createWallet,
  InputError,
  safeError,
  signTransfer,
  tokenBalance,
  walletAddress,
} from './wallet.ts'

const help = `Sepolia 命令行钱包（从项目目录执行）
  npm run wallet -- create
  npm run wallet -- balance [--address 0x...] [--token 0x...]
  npm run wallet -- transfer --token 0x... --to 0x... --amount 1.25 --max-fee-gwei 20 [--send]
  npm run wallet -- receipt --hash 0x...

transfer 默认只模拟和预览。--send 才会要求确认、解锁、签名并广播。
--max-fee-gwei 是每单位 Gas 的最高价格；预览还会显示总费用上限。
私钥保存在 .wallet/keystore.json（加密），密码仅在交互终端隐藏输入。`

async function ask(prompt: string, hidden = false): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new InputError('创建钱包和发送交易需要交互终端。')
  }
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done()
    },
  })
  const rl = createInterface({
    input: process.stdin,
    output: hidden ? muted : process.stdout,
    terminal: true,
  })
  const controller = new AbortController()
  rl.on('SIGINT', () => controller.abort())
  try {
    if (hidden) process.stdout.write(prompt)
    return await rl.question(hidden ? '' : prompt, {
      signal: controller.signal,
    })
  } finally {
    rl.close()
    if (hidden) process.stdout.write('\n')
    muted.destroy()
  }
}

async function main() {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        address: { type: 'string' },
        token: { type: 'string' },
        to: { type: 'string' },
        amount: { type: 'string' },
        'max-fee-gwei': { type: 'string' },
        hash: { type: 'string' },
        send: { type: 'boolean' },
      },
    })
  } catch {
    throw new InputError('命令参数无效，请运行 npm run wallet -- --help。')
  }
  const { positionals, values } = parsed
  const command = positionals[0]
  if (values.help || positionals.length === 0) return console.log(help)
  if (
    positionals.length !== 1 ||
    !['create', 'balance', 'transfer', 'receipt'].includes(command ?? '')
  ) {
    throw new InputError('未知命令，请运行 npm run wallet -- --help。')
  }
  const allowed: Record<string, string[]> = {
    create: [],
    balance: ['address', 'token'],
    transfer: ['token', 'to', 'amount', 'max-fee-gwei', 'send'],
    receipt: ['hash'],
  }
  if (
    Object.keys(values).some((key) => !allowed[command ?? '']?.includes(key))
  ) {
    throw new InputError('此命令包含不适用的参数，请查看 --help。')
  }
  const required = (name: string) => {
    const value = values[name]
    if (typeof value !== 'string' || !value)
      throw new InputError(`缺少 --${name}。`)
    return value
  }
  const file = resolve('.wallet/keystore.json')
  if (command === 'create') {
    const password = await ask('设置 keystore 密码（至少 12 字符）：', true)
    if (password !== (await ask('再次输入密码：', true)))
      throw new InputError('两次密码不同。')
    const owner = await createWallet(file, password)
    console.log(
      `钱包地址：${owner}\n加密文件：${file}\n可向此地址转入 Sepolia ETH 和 ERC20 测试币。`,
    )
    return
  }

  let provider: JsonRpcProvider | undefined
  try {
    provider = connect(process.env.SEPOLIA_RPC_URL)
    await assertSepolia(provider)
    if (command === 'balance') {
      const owner = values.address
        ? address(required('address'))
        : await walletAddress(file)
      console.log(
        `地址：${owner}\nSepolia ETH：${formatEther(await provider.getBalance(owner))}`,
      )
      if (values.token) {
        const token = address(required('token'))
        const balance = await tokenBalance(provider, token, owner)
        console.log(
          `ERC20 合约：${token}\n代币精度：${balance.decimals}\nERC20 余额：${formatUnits(balance.raw, balance.decimals)}`,
        )
      }
      return
    }
    if (command === 'receipt') {
      const hash = required('hash')
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw new InputError('交易哈希必须为 32 字节。')
      const receipt = await provider.getTransactionReceipt(hash)
      if (!receipt) {
        console.log(
          '尚无回执：交易可能待确认，或 RPC 尚未收到；不要据此直接重发。',
        )
      } else {
        console.log(
          `状态：${receipt.status === 1 ? '执行成功' : '执行失败'}\n区块：${receipt.blockNumber}\n实际费用：${formatEther(receipt.fee)} ETH`,
        )
        if (receipt.status !== 1) process.exitCode = 1
      }
      console.log(`https://sepolia.etherscan.io/tx/${hash}`)
      return
    }
    const prepared = await buildTransfer(provider, {
      from: await walletAddress(file),
      token: required('token'),
      to: required('to'),
      amount: required('amount'),
      maxFee: required('max-fee-gwei'),
    })
    console.log(
      JSON.stringify(
        {
          network: 'Sepolia',
          ...prepared.transaction,
          recipient: prepared.recipient,
          tokenAmount: formatUnits(prepared.units, prepared.decimals),
          maxCostETH: formatEther(prepared.maxCost),
        },
        (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        2,
      ),
    )
    if (!values.send)
      return console.log('模拟成功，尚未签名或广播。确认参数后添加 --send。')
    if (
      (await ask('确认上述账户、代币、收款人、金额和费用上限？输入 SEND：')) !==
      'SEND'
    ) {
      console.log('已取消。')
      return
    }
    const { signed, hash } = await signTransfer(
      file,
      await ask('keystore 密码：', true),
      prepared.transaction,
    )
    const record = resolve('.wallet', `${hash}.json`)
    console.log(`本地交易哈希：${hash}\n广播记录：${record}`)
    const response = await broadcast(provider, signed, record)
    console.log(`已广播：https://sepolia.etherscan.io/tx/${hash}`)
    const receipt = await response.wait(1, 120_000)
    if (receipt?.status !== 1)
      throw new InputError('未取得成功回执，请使用 receipt 查询原交易。')
    console.log(
      `执行成功，区块 ${receipt.blockNumber}，实际费用 ${formatEther(receipt.fee)} ETH。`,
    )
  } finally {
    provider?.destroy()
  }
}

main().catch((error: unknown) => {
  console.error(safeError(error))
  process.exitCode = 1
})

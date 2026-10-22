import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { createServer } from 'node:net'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'

const seller = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const buyer = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

// 只启动独立本地链，部署真实合约并验证普通与回调成交，最后关闭自己创建的进程。
test('Anvil 部署、改价、成交与再次出售', { timeout: 120_000 }, async () => {
  const reservation = createServer()
  // 操作系统分配空闲端口，不碰用户已有的 Anvil。
  await new Promise<void>((resolve) =>
    reservation.listen(0, '127.0.0.1', resolve),
  )
  const address = reservation.address()
  assert(address && typeof address !== 'string')
  const port = address.port
  // 启动前释放端口；若被其他进程抢占，后续退出检查会使测试失败。
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  )
  const rpc = `http://127.0.0.1:${port}`
  const directory = new URL(
    '../../output-tdd/nft-market-subgraph-31/',
    import.meta.url,
  )
  mkdirSync(directory, { recursive: true })
  const log = openSync(new URL('anvil.log', directory), 'w')
  const anvil = spawn(
    'anvil',
    ['--silent', '--host', '127.0.0.1', '--port', String(port)],
    { stdio: ['ignore', log, log] },
  )
  let startupError: Error | undefined
  // 捕获找不到 Anvil 等启动错误，避免未处理的子进程事件。
  anvil.on('error', (error) => {
    startupError = error
  })
  /** 所有查询和交易都固定到本测试 RPC；只使用本地解锁账户，不处理密钥。 */
  function cast(args: string[]) {
    return execFileSync('cast', [...args, '--rpc-url', rpc], {
      encoding: 'utf8',
      timeout: 15_000,
    }).trim()
  }
  /** 提交本地交易并等待回执，失败即中止后续断言。 */
  function send(
    from: string,
    target: string,
    signature: string,
    ...args: string[]
  ) {
    cast(['send', '--unlocked', '--from', from, target, signature, ...args])
  }
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt++) {
      if (startupError) throw startupError
      assert.equal(anvil.exitCode, null, '本次 Anvil 启动失败')
      try {
        ready = cast(['chain-id']) === '31337'
      } catch {
        /* 节点尚未监听时等待下一次探测。 */
      }
      if (ready) break
      await setTimeout(100)
    }
    assert(ready, 'Anvil 未就绪')
    const output = execFileSync(
      'forge',
      [
        'script',
        'script/Deploy.s.sol:Deploy',
        '--rpc-url',
        rpc,
        '--sender',
        seller,
        '--unlocked',
        '--broadcast',
      ],
      { encoding: 'utf8', timeout: 60_000 },
    )
    const nft = output.match(/NFT (0x[0-9a-fA-F]{40})/)?.[1]
    const token = output.match(/PAY_TOKEN (0x[0-9a-fA-F]{40})/)?.[1]
    const market = output.match(/MARKET (0x[0-9a-fA-F]{40})/)?.[1]
    assert(nft && token && market, '部署输出缺少地址')
    assert.equal(
      cast(['call', market, 'nft()(address)']).toLowerCase(),
      nft.toLowerCase(),
    )
    assert.equal(
      cast(['call', market, 'paymentToken()(address)']).toLowerCase(),
      token.toLowerCase(),
    )
    send(
      seller,
      nft,
      'mint(address,uint256,string)',
      seller,
      '1',
      'ipfs://example/1.json',
    )
    send(seller, nft, 'approve(address,uint256)', market, '1')
    send(seller, token, 'transfer(address,uint256)', buyer, '1000')
    send(seller, market, 'list(uint256,uint256)', '1', '100')
    send(seller, market, 'list(uint256,uint256)', '1', '120')
    send(buyer, token, 'approve(address,uint256)', market, '120')
    send(buyer, market, 'buyNFT(uint256)', '1')
    assert.equal(
      cast(['call', nft, 'ownerOf(uint256)(address)', '1']).toLowerCase(),
      buyer.toLowerCase(),
    )
    assert.equal(
      cast(['call', token, 'balanceOf(address)(uint256)', buyer]),
      '880',
    )
    send(buyer, nft, 'approve(address,uint256)', market, '1')
    send(buyer, market, 'list(uint256,uint256)', '1', '150')
    const data = execFileSync('cast', ['abi-encode', 'f(uint256)', '1'], {
      encoding: 'utf8',
    }).trim()
    send(
      seller,
      token,
      'transferWithCallback(address,uint256,bytes)',
      market,
      '150',
      data,
    )
    assert.equal(
      cast(['call', nft, 'ownerOf(uint256)(address)', '1']).toLowerCase(),
      seller.toLowerCase(),
    )
    assert.equal(
      cast(['call', token, 'balanceOf(address)(uint256)', buyer]),
      '1030',
    )
    assert.equal(
      cast(['call', token, 'balanceOf(address)(uint256)', market]),
      '0',
    )
    assert.match(
      cast(['call', market, 'listings(uint256)(address,uint256)', '1']),
      /^0x0{40}\s+0$/,
    )
  } finally {
    anvil.kill('SIGTERM')
    // 等待节点释放端口，不留下后台测试链。
    if (anvil.exitCode === null && !startupError)
      await new Promise<void>((resolve) => anvil.once('exit', () => resolve()))
    closeSync(log)
  }
})

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 只接受本项目支持的网络、非零地址和安全整数区块；不进行链上写入。 */
export function parseConfig(args: string[]) {
  const [network, address, block] = args
  if (args.length !== 3 || (network !== 'sepolia' && network !== 'local')) {
    throw new Error(
      '用法：npm run configure -- <sepolia|local> <市场地址> <部署区块>',
    )
  }
  if (
    !address ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    /^0x0{40}$/.test(address)
  ) {
    throw new Error('市场地址必须是非零的 20 字节十六进制地址')
  }
  if (
    !block ||
    !/^[1-9][0-9]*$/.test(block) ||
    !Number.isSafeInteger(Number(block))
  ) {
    throw new Error('部署区块必须是大于 0 的安全整数，不接受指数或小数')
  }
  return { network, address: address.toLowerCase(), block }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { network, address, block } = parseConfig(process.argv.slice(2))
  const template = readFileSync(
    new URL('../subgraph.yaml', import.meta.url),
    'utf8',
  )
  const manifest = template
    .replace('network: sepolia', `network: ${network}`)
    .replace('0x0000000000000000000000000000000000000000', address)
    .replace('startBlock: 0', `startBlock: ${block}`)
  const path = new URL(`../subgraph.${network}.yaml`, import.meta.url)
  writeFileSync(path, manifest, { flag: 'wx' })
  console.log(
    `已创建 ${fileURLToPath(path)}；请核对地址、网络和部署区块后再部署子图。`,
  )
}

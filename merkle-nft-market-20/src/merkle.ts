import {
  type Address,
  concatHex,
  encodeAbiParameters,
  getAddress,
  type Hex,
  isAddress,
  keccak256,
  zeroAddress,
} from 'viem'

/** 构造地址白名单；双哈希叶子、排序节点对、奇数末节点直接晋级，返回根和每个地址的证明。 */
export function buildMerkleTree(addresses: readonly string[]) {
  if (addresses.length === 0) throw new Error('白名单不能为空')
  const members: Address[] = []
  const seen = new Set<Address>()
  for (const address of addresses) {
    if (!isAddress(address) || getAddress(address) === zeroAddress) {
      throw new Error(`无效白名单地址：${address}`)
    }
    const normalized = getAddress(address)
    if (seen.has(normalized)) throw new Error(`重复地址：${normalized}`)
    seen.add(normalized)
    members.push(normalized)
  }
  // 用 abi.encode 而非 packed address；第二次哈希使叶子与两个 bytes32 的内部节点结构不同。
  const leaves = members.map((address) =>
    keccak256(keccak256(encodeAbiParameters([{ type: 'address' }], [address]))),
  )
  const levels: Hex[][] = [leaves]
  let level = leaves
  while (level.length > 1) {
    const next: Hex[] = []
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]
      const b = level[i + 1]
      // 固定长度小写 hex 的字典序等于 bytes32 数值序，与 MerkleProof 的排序一致。
      next.push(
        b === undefined ? a : keccak256(concatHex(a < b ? [a, b] : [b, a])),
      )
    }
    levels.push(next)
    level = next
  }
  // 输入地址顺序决定树形；不补零、不复制奇数末节点，证明只收集实际存在的兄弟。
  const entries = members.map((address, index) => {
    const proof: Hex[] = []
    let position = index
    for (const level of levels.slice(0, -1)) {
      const sibling = level[position % 2 === 0 ? position + 1 : position - 1]
      if (sibling !== undefined) proof.push(sibling)
      position = Math.floor(position / 2)
    }
    return { address, proof }
  })
  return { root: level[0], entries }
}

// 命令行只输出可复制 JSON；导入本模块不会写文件或执行链上操作。
if (import.meta.main) {
  console.log(JSON.stringify(buildMerkleTree(process.argv.slice(2)), null, 2))
}

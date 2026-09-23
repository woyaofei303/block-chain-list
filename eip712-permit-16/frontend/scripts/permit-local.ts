import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import {
  createPublicClient,
  createWalletClient,
  type Hash,
  http,
  isHex,
  parseAbi,
  parseEther,
} from "viem"
import { anvil } from "viem/chains"

export const marketAbi = parseAbi([
  "function list(uint256,uint256)",
  "function permitBuy(uint256,uint256,bytes)",
  "function nonces(address) view returns (uint256)",
  "function listings(uint256) view returns (address seller,uint256 price)",
])
export const nftAbi = parseAbi([
  "function safeMint(address,string) returns (uint256)",
  "function approve(address,uint256)",
  "function ownerOf(uint256) view returns (address)",
])

// 只用于全新本地 Anvil；不读取钱包密钥，不连接公共 RPC。
export async function deployPractice(url: string) {
  const parsed = new URL(url)
  assert.ok(
    parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname),
    "只允许本地 HTTP RPC"
  )
  const transport = http(url, { retryCount: 0 })
  const client = createPublicClient({ chain: anvil, transport, pollingInterval: 50 })
  assert.equal(await client.getChainId(), 31337, "只允许本地 Anvil 链")
  const wallet = createWalletClient({ chain: anvil, transport })
  const [seller, buyer] = await wallet.getAddresses()
  assert.ok(seller && buyer, "需要两个 Anvil 解锁模拟账户")
  const root = resolve(import.meta.dirname, "../../contracts")
  const bytecode = (name: string) => {
    const code = execFileSync("forge", ["inspect", name, "bytecode", "--root", root], {
      encoding: "utf8",
    }).trim()
    assert.ok(isHex(code), "Forge 必须返回合约字节码")
    return code
  }
  const mined = async (hash: Hash) => {
    const receipt = await client.waitForTransactionReceipt({ hash })
    assert.equal(receipt.status, "success")
    return receipt
  }
  const deployed = async (hash: Hash) => {
    const receipt = await mined(hash)
    assert.ok(receipt.contractAddress)
    return receipt.contractAddress
  }
  const token = await deployed(
    await wallet.deployContract({ account: seller, abi: [], bytecode: bytecode("JulianToken") })
  )
  const bank = await deployed(
    await wallet.deployContract({
      account: seller,
      abi: parseAbi(["constructor(address)"]),
      args: [token],
      bytecode: bytecode("IdempotentTokenBank"),
    })
  )
  const nft = await deployed(
    await wallet.deployContract({
      account: seller,
      abi: parseAbi(["constructor(address)"]),
      args: [seller],
      bytecode: bytecode("BlocklightGenesis"),
    })
  )
  const market = await deployed(
    await wallet.deployContract({
      account: seller,
      abi: parseAbi(["constructor(address,address,address)"]),
      args: [token, nft, seller],
      bytecode: bytecode("PermitNFTMarket"),
    })
  )
  await mined(
    await wallet.writeContract({
      account: seller,
      address: token,
      abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
      functionName: "transfer",
      args: [buyer, parseEther("1000")],
    })
  )
  await mined(
    await wallet.writeContract({
      account: seller,
      address: nft,
      abi: nftAbi,
      functionName: "safeMint",
      args: [seller, "ipfs://practice/metadata.json"],
    })
  )
  await mined(
    await wallet.writeContract({
      account: seller,
      address: nft,
      abi: nftAbi,
      functionName: "approve",
      args: [market, 0n],
    })
  )
  await mined(
    await wallet.writeContract({
      account: seller,
      address: market,
      abi: marketAbi,
      functionName: "list",
      args: [0n, parseEther("100")],
    })
  )
  return { client, wallet, mined, seller, buyer, token, bank, nft, market }
}

import { deployPractice } from "./permit-local.ts"

const rpc = process.argv[2] ?? "http://127.0.0.1:8547"
const { seller, buyer, token, bank, permit2, nft, market } = await deployPractice(rpc)
console.log(
  JSON.stringify({ chainId: 31337, rpc, seller, buyer, token, bank, permit2, nft, market }, null, 2)
)
console.error("本地部署完成：buyer 已收到 1000 JUL，Blocklight Genesis #0 已按 100 JUL 上架。")
console.error("在钱包选择本地网络及 buyer，网页填写 bank 地址。重复执行会创建新合约。")

import {
  decodeFunctionData,
  type Hash,
  type PublicClient,
  parseAbi,
  zeroHash,
} from 'viem'
import { type Operation, OperationError } from './repository.ts'

export const operationAbi = parseAbi([
  'function operationHash(address, bytes32) view returns (bytes32)',
  'function deposit(uint256 amount, bytes32 operationId)',
  'function withdraw(uint256 amount, bytes32 operationId)',
  'event OperationExecuted(address indexed user, bytes32 indexed operationId, bool deposit, uint256 amount)',
  'function permitDeposit(uint256 amount,bytes32 operationId,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
])

export async function inspectOperation(
  rpc: PublicClient,
  operation: Operation,
  hashes: Hash[],
  confirmations: bigint,
) {
  const head = await rpc.getBlockNumber({ cacheTime: 0 })
  const through = head - confirmations
  if (through < BigInt(operation.startBlock))
    return { status: 'pending' as const, transactionHash: null }
  const anchor = await rpc.getBlock({ blockNumber: through })
  const digest = await rpc.readContract({
    address: operation.bankAddress,
    abi: operationAbi,
    functionName: 'operationHash',
    args: [operation.account, operation.operationId],
    blockNumber: through,
  })
  if (digest !== zeroHash && digest !== operation.payloadHash)
    throw new OperationError(
      409,
      'CHAIN_CONFLICT',
      '链上该操作编号的参数不一致',
    )
  if (digest === operation.payloadHash) {
    // ponytail: 学习数据按 2000 块查询操作事件；长期大量订单应扩展现有索引器保存此事件。
    for (
      let fromBlock = BigInt(operation.startBlock);
      fromBlock <= through;
      fromBlock += 2000n
    ) {
      const toBlock = fromBlock + 1999n < through ? fromBlock + 1999n : through
      const logs = await rpc.getLogs({
        address: operation.bankAddress,
        event: operationAbi[3],
        args: { user: operation.account, operationId: operation.operationId },
        strict: true,
        fromBlock,
        toBlock,
      })
      const log = logs.find(
        (entry) =>
          entry.args.deposit === (operation.action === 'deposit') &&
          entry.args.amount === BigInt(operation.amountRaw),
      )
      if (log) {
        if ((await rpc.getBlock({ blockNumber: through })).hash !== anchor.hash)
          throw new OperationError(
            503,
            'CHAIN_CHANGED',
            '链状态变化，请稍后重新核实',
          )
        return {
          status: 'confirmed' as const,
          transactionHash: log.transactionHash,
        }
      }
    }
    throw new OperationError(
      503,
      'EVIDENCE_UNAVAILABLE',
      '操作结果正在核实，请稍后查看',
    )
  }
  // 客户端提交的哈希只是线索；必须核对发送者、目标和完整调用参数。
  let failed: Hash | undefined
  let uncertain = false
  for (const hash of hashes) {
    try {
      const transaction = await rpc.getTransaction({ hash })
      if (
        transaction.from.toLowerCase() !== operation.account ||
        transaction.to?.toLowerCase() !== operation.bankAddress
      )
        continue
      const call = decodeFunctionData({
        abi: operationAbi,
        data: transaction.input,
      })
      if (
        (call.functionName === 'permitDeposit'
          ? 'deposit'
          : call.functionName) !== operation.action ||
        call.args[0] !== BigInt(operation.amountRaw) ||
        call.args[1] !== operation.operationId
      )
        continue
      const receipt = await rpc.getTransactionReceipt({ hash })
      if (
        receipt.blockNumber > through ||
        (await rpc.getBlock({ blockNumber: receipt.blockNumber })).hash !==
          receipt.blockHash
      ) {
        uncertain = true
        continue
      }
      if (receipt.status === 'reverted') failed = hash
      else uncertain = true
    } catch {
      uncertain = true // 未找到或尚未打包不能标成成功或失败。
    }
  }
  if (failed && !uncertain)
    return { status: 'failed' as const, transactionHash: failed }
  return { status: 'pending' as const, transactionHash: null }
}

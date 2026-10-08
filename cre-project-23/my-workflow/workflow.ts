import {
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk'
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  parseAbiParameters,
  zeroAddress,
} from 'viem'
import { z } from 'zod'

// 配置在信任边界校验；本练习只接 Sepolia，金额完全从合约读取。
export const configSchema = z.object({
  schedule: z.string().min(1),
  evms: z
    .array(
      z.object({
        chainSelectorName: z.literal('ethereum-testnet-sepolia'),
        // 验证地址后规范化，不用类型断言把任意字符串当作地址。
        contractAddress: z
          .string()
          .refine(isAddress, 'Invalid Receiver address')
          .transform((address) => getAddress(address))
          .refine(
            (address) => address !== zeroAddress,
            'Zero Receiver address',
          ),
      }),
    )
    .length(1),
})
export type Config = z.infer<typeof configSchema>

// 与 Solidity getState() 对齐；集成测试通过真实 RPC 调用校验 ABI。
export const receiverAbi = parseAbi([
  'function getState() view returns (uint256 deposits, uint256 limit, address to, uint256 nonce)',
])

/** Cron 回调读取单一区块快照；超阈值才生成带序号的报告，链上再次复核条件。 */
export function onCronTrigger(runtime: Runtime<Config>): string {
  const config = configSchema.parse(runtime.config).evms[0]
  if (!config) throw new Error('One EVM config required')
  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error('Sepolia network unavailable')
  const client = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const readResult = client
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: config.contractAddress,
        data: encodeFunctionData({
          abi: receiverAbi,
          functionName: 'getState',
        }),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()
  const [deposits, threshold, recipient, nonce] = decodeFunctionResult({
    abi: receiverAbi,
    functionName: 'getState',
    data: bytesToHex(readResult.data),
  })
  runtime.log(
    `TokenBank: deposits=${deposits}, threshold=${threshold}, recipient=${recipient}, nonce=${nonce}`,
  )
  if (deposits <= threshold) {
    runtime.log('Skipped: deposits <= threshold')
    return 'Skipped'
  }

  const payload = encodeAbiParameters(parseAbiParameters('uint256 nonce'), [
    nonce,
  ])
  const report = runtime.report(prepareReportRequest(payload)).result()
  const result = client
    .writeReport(runtime, {
      receiver: config.contractAddress,
      report,
      // 100 个历史存款人的最大扫描量已由 Forge gas 测试覆盖。
      gasConfig: { gasLimit: '1500000' },
    })
    .result()
  if (result.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Write failed: ${result.errorMessage || result.txStatus}`)
  }
  if (result.receiverContractExecutionStatus !== 0) {
    throw new Error(
      `Receiver execution not confirmed: ${result.receiverContractExecutionStatus}`,
    )
  }
  // dry-run 可能没有真实交易哈希；不伪造 0x000… 作为成功交易证据。
  const tx = result.txHash?.some((byte) => byte !== 0)
    ? bytesToHex(result.txHash)
    : 'not broadcast'
  runtime.log(
    `Report accepted: observedHalf=${deposits / 2n}, nonce=${nonce}, tx=${tx}`,
  )
  return `Executed: ${tx}`
}

/** 注册一个 Cron handler；实际定时运行需要另行部署激活 CRE workflow。 */
export function initWorkflow(config: Config) {
  const cron = new cre.capabilities.CronCapability()
  return [
    cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger),
  ]
}

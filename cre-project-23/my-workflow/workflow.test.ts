import { expect } from 'bun:test'
import {
  addContractMock,
  EvmMock,
  newTestRuntime,
  REPORT_METADATA_HEADER_LENGTH,
  test,
} from '@chainlink/cre-sdk/test'
import { bytesToHex, decodeAbiParameters, parseAbiParameters } from 'viem'
import {
  configSchema,
  initWorkflow,
  onCronTrigger,
  receiverAbi,
} from './workflow'

export const CHAIN_SELECTOR = 16015286601757825753n
const receiverAddress = '0x0000000000000000000000000000000000000010'
const recipient = '0x0000000000000000000000000000000000000020'
const config = configSchema.parse({
  schedule: '0 */5 * * * *',
  evms: [
    {
      chainSelectorName: 'ethereum-testnet-sepolia',
      contractAddress: receiverAddress,
    },
  ],
})

/** 检查超过阈值时写入正确 Receiver、正确 nonce，以及配置的 gas 上限。 */
test('above threshold sends one nonce-bound report', () => {
  const mock = addContractMock(EvmMock.testInstance(CHAIN_SELECTOR), {
    address: receiverAddress,
    abi: receiverAbi,
  })
  // 模拟金额远大于 Number 安全上限，确保报告路径始终使用 bigint。
  mock.getState = () => [
    120000000000000000000n,
    100000000000000000000n,
    recipient,
    7n,
  ]
  let writes = 0
  // 在 SDK 边界检查真实编码报告，不只断言返回的字符串。
  mock.writeReport = (input) => {
    writes++
    expect(bytesToHex(input.receiver)).toBe(receiverAddress)
    expect(input.gasConfig.gasLimit).toBe(1500000n)
    const payload = bytesToHex(
      input.report.rawReport.slice(REPORT_METADATA_HEADER_LENGTH),
    )
    expect(decodeAbiParameters(parseAbiParameters('uint256'), payload)).toEqual(
      [7n],
    )
    return {
      txStatus: 'TX_STATUS_SUCCESS',
      receiverContractExecutionStatus:
        'RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS',
    }
  }
  const runtime = newTestRuntime(undefined, {}, config)
  expect(onCronTrigger(runtime)).toBe('Executed: not broadcast')
  expect(writes).toBe(1)
})

// 每个边界在独立 CRE runtime 注册表中执行，低于或等于阈值绝不能写入。
for (const deposits of [0n, 99n, 100n]) {
  /** 验证严格大于语义，并检查跳过路径没有调用 writeReport。 */
  test(`deposits=${deposits} skips without writing`, () => {
    const mock = addContractMock(EvmMock.testInstance(CHAIN_SELECTOR), {
      address: receiverAddress,
      abi: receiverAbi,
    })
    mock.getState = () => [deposits, 100n, recipient, 1n]
    mock.writeReport = () => {
      throw new Error('Unexpected write')
    }
    expect(onCronTrigger(newTestRuntime(undefined, {}, config))).toBe('Skipped')
  })
}

// Forwarder 的交易成功与 Receiver 执行成功必须分别判断。
for (const reply of [
  {
    txStatus: 'TX_STATUS_REVERTED',
    receiverContractExecutionStatus:
      'RECEIVER_CONTRACT_EXECUTION_STATUS_SUCCESS',
  },
  {
    txStatus: 'TX_STATUS_SUCCESS',
    receiverContractExecutionStatus:
      'RECEIVER_CONTRACT_EXECUTION_STATUS_REVERTED',
  },
  { txStatus: 'TX_STATUS_SUCCESS' },
] as const) {
  /** 写入失败、Receiver 回滚和缺少确认均不得被记成成功。 */
  test(`rejects unconfirmed write ${JSON.stringify(reply)}`, () => {
    const mock = addContractMock(EvmMock.testInstance(CHAIN_SELECTOR), {
      address: receiverAddress,
      abi: receiverAbi,
    })
    mock.getState = () => [120n, 100n, recipient, 1n]
    mock.writeReport = () => reply
    expect(() => onCronTrigger(newTestRuntime(undefined, {}, config))).toThrow()
  })
}

/** 配置拒绝空列表、无效/零地址和非目标链；Cron 注册保持配置 schedule。 */
test('validates external config and registers cron', () => {
  expect(configSchema.safeParse({ ...config, evms: [] }).success).toBe(false)
  for (const address of ['bad', '0x0000000000000000000000000000000000000000']) {
    expect(
      configSchema.safeParse({
        ...config,
        evms: [{ ...config.evms[0], contractAddress: address }],
      }).success,
    ).toBe(false)
  }
  expect(
    configSchema.safeParse({
      ...config,
      evms: [{ ...config.evms[0], chainSelectorName: 'ethereum-mainnet' }],
    }).success,
  ).toBe(false)
  const handlers = initWorkflow(config)
  expect(handlers).toHaveLength(1)
  expect(handlers[0]?.fn).toBe(onCronTrigger)
})

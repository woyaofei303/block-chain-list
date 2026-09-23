import type { Address } from 'viem'

export type TransferScope = {
  chainId: number
  tokenAddress: Address
}

export type ScanConfig = TransferScope & {
  startBlock: bigint
  confirmations: bigint
  batchSize: bigint
}

export type TokenMetadata = {
  symbol: string | null
  decimals: number
}

export type TransferQuery = {
  address: string
  limit: number
  offset: number
}

// PostgreSQL numeric/bigint 和 HTTP 金额保持十进制字符串，不经过 Number。
export type TransferRecord = {
  blockNumber: string
  blockHash: string
  transactionHash: string
  logIndex: number
  fromAddress: string
  toAddress: string
  valueRaw: string
}

export type TransferPage = {
  indexedThrough: string | null
  transfers: TransferRecord[]
}

export type TransferResponse = TokenMetadata &
  TransferQuery & {
    chainId: number
    tokenAddress: string
    indexedThrough: TransferPage['indexedThrough']
    transfers: (TransferRecord & { value: string })[]
  }

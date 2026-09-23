import { type Address, type Hash, isAddress, maxUint256 } from "viem"
import { AppError } from "../../shared/errors.ts"
import { request } from "../../shared/request.ts"

export type Transfer = {
  transactionHash: Hash
  logIndex: number
  blockNumber: string
  fromAddress: Address
  toAddress: Address
  valueRaw: string
}

export async function loadTransfers(
  endpoint: string,
  expected: {
    chainId: number
    token: Address
    account: Address
    decimals: number
  },
  offset = 0,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({
    address: expected.account,
    limit: "10",
    offset: String(offset),
  })
  return request(`${endpoint}?${query}`, {
    signal,
    parse: (value: unknown) => {
      const data = value as Record<string, unknown> | null
      if (!data || typeof data !== "object")
        throw new AppError("business", "INVALID_TRANSFERS", "转账记录服务返回了无效数据")
      if (
        data.chainId !== expected.chainId ||
        typeof data.tokenAddress !== "string" ||
        data.tokenAddress.toLowerCase() !== expected.token.toLowerCase() ||
        typeof data.address !== "string" ||
        data.address.toLowerCase() !== expected.account.toLowerCase() ||
        data.decimals !== expected.decimals
      )
        throw new AppError(
          "business",
          "INDEXER_MISMATCH",
          "后端网络、Token 或查询地址不匹配，请检查索引器配置"
        )
      if (
        !Array.isArray(data.transfers) ||
        data.transfers.length > 10 ||
        !(
          data.indexedThrough === null ||
          (typeof data.indexedThrough === "string" && /^\d+$/.test(data.indexedThrough))
        ) ||
        !data.transfers.every(
          (row: Transfer) =>
            row != null &&
            typeof row === "object" &&
            typeof row.transactionHash === "string" &&
            /^0x[\da-f]{64}$/i.test(row.transactionHash) &&
            Number.isSafeInteger(row.logIndex) &&
            row.logIndex >= 0 &&
            typeof row.blockNumber === "string" &&
            /^\d+$/.test(row.blockNumber) &&
            typeof row.fromAddress === "string" &&
            isAddress(row.fromAddress, { strict: false }) &&
            typeof row.toAddress === "string" &&
            isAddress(row.toAddress, { strict: false }) &&
            typeof row.valueRaw === "string" &&
            /^\d+$/.test(row.valueRaw) &&
            BigInt(row.valueRaw) <= maxUint256 &&
            [row.fromAddress.toLowerCase(), row.toAddress.toLowerCase()].includes(
              expected.account.toLowerCase()
            )
        )
      )
        throw new AppError("business", "INVALID_TRANSFERS", "转账记录服务返回了无效数据")
      return {
        transfers: data.transfers as Transfer[],
        indexedThrough: data.indexedThrough as string | null,
      }
    },
  })
}

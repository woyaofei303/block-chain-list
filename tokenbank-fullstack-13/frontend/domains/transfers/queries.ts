import { queryOptions } from "@tanstack/react-query"
import type { Address } from "viem"
import { loadTransfers } from "./client.ts"

/** 查询键隔离账户、网络与分页；signal 经 loadTransfers 传到共享队列和 fetch，真正取消请求。 */
export function transferOptions(
  expected: { chainId: number; token: Address; account: Address; decimals: number },
  offset: number
) {
  return queryOptions({
    queryKey: [
      "transfers",
      expected.chainId,
      expected.token.toLowerCase(),
      expected.account.toLowerCase(),
      expected.decimals,
      offset,
    ],
    queryFn: ({ signal }) => loadTransfers("/api/transfers", expected, offset, signal),
    refetchInterval: 15_000,
  })
}

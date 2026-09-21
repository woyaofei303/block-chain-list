import { queryOptions } from "@tanstack/react-query"
import type { Address } from "viem"
import { loadTransfers } from "./client.ts"

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

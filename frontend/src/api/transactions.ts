import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getJson } from "./client";
import type { Transaction, TransactionCounts, TransactionFilterQuery } from "./types";
import { transactionFilterParams } from "./filter";
import { keys } from "./keys";

// A page shorter than the page size is the last one.
const TRANSACTIONS_PAGE_SIZE = 200;

export function useTransactions(q: TransactionFilterQuery) {
  return useInfiniteQuery({
    queryKey: keys.transactions(q),
    queryFn: ({ pageParam, signal }) => {
      const params = transactionFilterParams(q);
      params.set("limit", String(TRANSACTIONS_PAGE_SIZE));
      params.set("offset", String(pageParam));
      return getJson<Transaction[]>(`/transactions?${params}`, { signal });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < TRANSACTIONS_PAGE_SIZE
        ? undefined
        : allPages.length * TRANSACTIONS_PAGE_SIZE,
    placeholderData: keepPreviousData,
  });
}

/** The header counts and part 3's `matching / total`. Separate from the list so
 *  paging does not refetch it and so an empty page can still tell "nothing
 *  ingested" from "nothing matches". */
export function useTransactionCounts(q: TransactionFilterQuery) {
  return useQuery({
    queryKey: keys.transactionCounts(q),
    queryFn: ({ signal }) => getJson<TransactionCounts>(`/transactions/counts?${transactionFilterParams(q)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

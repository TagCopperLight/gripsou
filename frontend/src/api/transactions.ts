import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { TRANSACTIONS_LIMIT_DEFAULT } from "./wire";
import { transactionFilterFields, type TransactionFilterQuery } from "./filter";
import { keys } from "./keys";

// A short page is the last one, so this must not exceed the server's `TRANSACTIONS_LIMIT_MAX`.
const TRANSACTIONS_PAGE_SIZE = TRANSACTIONS_LIMIT_DEFAULT;

export function useTransactions(q: TransactionFilterQuery) {
  return useInfiniteQuery({
    queryKey: keys.transactions(q),
    queryFn: ({ pageParam, signal }) =>
      api("GET /transactions", {
        query: { ...transactionFilterFields(q), limit: TRANSACTIONS_PAGE_SIZE, offset: pageParam },
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < TRANSACTIONS_PAGE_SIZE
        ? undefined
        : allPages.length * TRANSACTIONS_PAGE_SIZE,
    placeholderData: keepPreviousData,
  });
}

/** Separate from the list so paging does not refetch it. */
export function useTransactionCounts(q: TransactionFilterQuery) {
  return useQuery({
    queryKey: keys.transactionCounts(q),
    queryFn: ({ signal }) => api("GET /transactions/counts", { query: transactionFilterFields(q), signal }),
    placeholderData: keepPreviousData,
  });
}

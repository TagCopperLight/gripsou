import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, patchJson } from "./client";
import type { Account, AccountSeries, NetWorthResponse, UpdateAccountReq, UpdatedAccount } from "./wire";
import { keys } from "./keys";
import { afterAccountEdit } from "./invalidate";

// Reuse portfolio reads during quick navigation. Syncs, edits and reporting
// preference changes invalidate these queries before the window expires.
export const PORTFOLIO_STALE_MS = 30_000;

export function useNetWorth(range: string) {
  return useQuery({
    queryKey: keys.netWorth(range),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => getJson<NetWorthResponse>(`/dashboard/net-worth?range=${range}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: keys.accounts(),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => getJson<Account[]>(`/accounts`, { signal }),
  });
}

export function useAccountSeries(range: string) {
  return useQuery({
    queryKey: keys.accountSeries(range),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => getJson<AccountSeries>(`/accounts/series?range=${range}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAccountTypes() {
  return useQuery({
    queryKey: keys.accountTypes(),
    queryFn: ({ signal }) => getJson<string[]>(`/account-types`, { signal }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, typeKey, color }: UpdateAccountReq & { id: string }) =>
      patchJson<UpdatedAccount>(`/accounts/${id}`, { name, typeKey, color }),
    onSuccess: () => afterAccountEdit(qc),
  });
}

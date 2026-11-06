import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { Range, UpdateAccountReq } from "./wire";
import { keys } from "./keys";
import { afterAccountEdit } from "./invalidate";

// Reuse portfolio reads during quick navigation. Syncs, edits and reporting
// preference changes invalidate these queries before the window expires.
export const PORTFOLIO_STALE_MS = 30_000;

export function useNetWorth(range: Range) {
  return useQuery({
    queryKey: keys.netWorth(range),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => api("GET /dashboard/net-worth", { query: { range }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: keys.accounts(),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => api("GET /accounts", { signal }),
  });
}

export function useAccountSeries(range: Range) {
  return useQuery({
    queryKey: keys.accountSeries(range),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => api("GET /accounts/series", { query: { range }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAccountTypes() {
  return useQuery({
    queryKey: keys.accountTypes(),
    queryFn: ({ signal }) => api("GET /account-types", { signal }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, typeKey, color }: UpdateAccountReq & { id: string }) =>
      api("PATCH /accounts/:id", { params: { id }, body: { name, typeKey, color } }),
    onSuccess: () => afterAccountEdit(qc),
  });
}

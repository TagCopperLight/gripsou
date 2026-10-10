import { useEffect } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { deleteJson, getAuthToken, getJson, patchJson, postJson, putJson } from "./client";
import type {
  Account,
  AccountSeries,
  AccountType,
  BasisPreview,
  DistributionAccount,
  EnabledProvider,
  Holding,
  InvestmentReturns,
  Lot,
  LotSuggestion,
  NetWorthResponse,
  PricePoint,
  Provider,
  ProviderGroup,
  Session,
  SessionUser,
  Transaction,
  TransactionCounts,
  TransactionFilterQuery,
  User,
} from "./types";
import { hasSyncing } from "./types";
import { transactionFilterParams } from "./filter";
import { keys } from "./keys";
import { watchSync } from "./watchSync";
import {
  afterAccountEdit,
  afterConnectionDeleted,
  afterLotsSaved,
  afterProviderChange,
  afterCorsOriginsChange,
  afterSessionChange,
  afterSyncRequested,
  afterUserChange,
} from "./invalidate";

export function useNetWorth(range: string) {
  return useQuery({
    queryKey: keys.netWorth(range),
    queryFn: ({ signal }) => getJson<NetWorthResponse>(`/dashboard/net-worth?range=${range}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export type Health = { status: string; version: string };

export function useHealth() {
  return useQuery({
    queryKey: keys.health(),
    // The version cannot change without a page reload, so never refetch it.
    queryFn: ({ signal }) => getJson<Health>(`/health`, { signal }),
    staleTime: Infinity,
  });
}

export function useDistribution() {
  return useQuery({
    queryKey: keys.distribution(),
    queryFn: ({ signal }) => getJson<DistributionAccount[]>(`/dashboard/distribution`, { signal }),
  });
}

export function useHoldings() {
  return useQuery({
    queryKey: keys.holdings(),
    queryFn: ({ signal }) => getJson<Holding[]>(`/holdings`, { signal }),
  });
}

export function useInvestmentReturns() {
  return useQuery({
    queryKey: keys.investmentReturns(),
    queryFn: ({ signal }) => getJson<InvestmentReturns>(`/investments/returns`, { signal }),
  });
}

export type SaveLotAdd = {
  type: "buy" | "sell";
  /** `YYYY-MM-DD`, straight from `<input type="date">`. */
  date: string;
  quantity: string;
  unitPrice: string;
  /** Decimal string, amount domain. Omitting it means zero. */
  fee?: string;
};
export type SaveLotsInput = { adds: SaveLotAdd[]; deletes: string[] };

export function useLotsPreview(id: string) {
  return useMutation({
    mutationFn: (rows: SaveLotAdd[]) =>
      postJson<BasisPreview>(`/holdings/${id}/lots/preview`, { rows }),
  });
}

export function useSaveLots(holdingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batch: SaveLotsInput) =>
      putJson<void>(`/holdings/${holdingId}/lots`, batch),
    onSuccess: () => afterLotsSaved(qc, holdingId),
  });
}

export function useHoldingPrices(id: string, range: string) {
  return useQuery({
    queryKey: keys.holdingPrices(id, range),
    queryFn: ({ signal }) => getJson<PricePoint[]>(`/holdings/${id}/prices?range=${range}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useHoldingLots(id: string) {
  return useQuery({
    queryKey: keys.holdingLots(id),
    queryFn: ({ signal }) => getJson<Lot[]>(`/holdings/${id}/lots`, { signal }),
  });
}

export function useLotSuggestions(id: string) {
  return useQuery({
    queryKey: keys.holdingLotSuggestions(id),
    retry: false, // suggestions are optional: fall back to the empty form fast
    queryFn: ({ signal }) => getJson<LotSuggestion[]>(`/holdings/${id}/lots/suggestions`, { signal }),
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: keys.accounts(),
    queryFn: ({ signal }) => getJson<Account[]>(`/accounts`, { signal }),
  });
}

export function useAccountSeries(range: string) {
  return useQuery({
    queryKey: keys.accountSeries(range),
    queryFn: ({ signal }) => getJson<AccountSeries>(`/accounts/series?range=${range}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

// The Transactions list pages through useInfiniteQuery's built-in page
// tracking: the table fetches the next page on scroll, with a load-more button
// as the accessible fallback. Each page asks for PAGE_SIZE rows at `offset`;
// a page shorter than PAGE_SIZE means there is nothing left to fetch.
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
    // Changing any filter changes the queryKey, which makes react-query start
    // a fresh page-1 fetch on its own — the reset a filter change needs falls
    // out of this for free, with no extra state to keep in sync.
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

export function useAccountTypes() {
  return useQuery({
    queryKey: keys.accountTypes(),
    queryFn: ({ signal }) => getJson<AccountType[]>(`/account-types`, { signal }),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: keys.users(),
    queryFn: ({ signal }) => getJson<User[]>(`/users`, { signal }),
  });
}

export type UpdateAccountInput = {
  id: string;
  name: string;
  typeKey: string;
  color: string;
};

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, typeKey, color }: UpdateAccountInput) =>
      patchJson(`/accounts/${id}`, { name, typeKey, color }),
    onSuccess: () => afterAccountEdit(qc),
  });
}

export type UpdateProfileInput = {
  name: string;
  email: string;
};

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, email }: UpdateProfileInput) =>
      patchJson<SessionUser>("/auth/me", { name, email }),
    onSuccess: () => {
      // The admin user list shows the current user's name/email; refresh it so
      // an edit is reflected there too.
      afterUserChange(qc);
    },
  });
}

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: ChangePasswordInput) =>
      postJson<void>("/auth/change-password", { currentPassword, newPassword }),
    onSuccess: () => {
      // Changing the password revokes all other sessions server-side; refresh
      // the sessions list so stale entries disappear immediately.
      afterSessionChange(qc);
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    // The email is re-typed by the user and verified server-side before the
    // account (and all its data) is permanently deleted.
    mutationFn: (email: string) => deleteJson<void>("/auth/account", { email }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions(),
    queryFn: ({ signal }) => getJson<Session[]>("/auth/sessions", { signal }),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson<void>(`/auth/sessions/${id}`),
    onSuccess: () => afterSessionChange(qc),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteJson<void>("/auth/sessions"),
    onSuccess: () => afterSessionChange(qc),
  });
}

export function useConnections() {
  const qc = useQueryClient();
  useEffect(() => watchSync(qc), [qc]);
  return useQuery({
    queryKey: keys.connections(),
    queryFn: ({ signal }) => getJson<ProviderGroup[]>("/connections", { signal }),
    // Check idle connections too: scheduled syncs and other tabs may finish
    // without this page ever seeing a running state.
    refetchInterval: (query) =>
      hasSyncing(query.state.data as ProviderGroup[] | undefined) ? 2000 : 30_000,
  });
}

export function useSyncConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postJson<void>(`/connections/${id}/sync`, {}),
    // Refresh so the connection's new 'syncing' state (and polling) kick in.
    onSuccess: () => afterSyncRequested(qc),
  });
}

export function useManageConnection() {
  return useMutation({
    mutationFn: async (id: string) => {
      const token = getAuthToken();
      const result = await postJson<{ redirectUrl: string }>(`/connections/${id}/manage`, {});
      if (token !== getAuthToken()) throw new Error("session changed");
      return result;
    },
  });
}

export function useSyncAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<void>("/sync", {}),
    onSuccess: () => afterSyncRequested(qc),
  });
}

export function useProviders() {
  return useQuery({
    queryKey: keys.providers(),
    queryFn: ({ signal }) => getJson<Provider[]>("/providers", { signal }),
  });
}

export function useSetProviderEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      patchJson<Provider>(`/providers/${key}`, { enabled }),
    // Optimistically flip the toggle; roll back on error.
    onMutate: async ({ key, enabled }) => {
      const token = getAuthToken();
      await qc.cancelQueries({ queryKey: keys.providers() });
      if (token !== getAuthToken()) throw new Error("session changed");
      const prev = qc.getQueryData<Provider[]>(keys.providers());
      qc.setQueryData<Provider[]>(keys.providers(), (old) =>
        old?.map((p) => (p.key === key ? { ...p, enabled } : p)),
      );
      return { prev, token };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.token === getAuthToken() && ctx.prev) qc.setQueryData(keys.providers(), ctx.prev);
    },
    onSettled: (_data, _error, _vars, ctx) => {
      if (ctx?.token === getAuthToken()) return afterProviderChange(qc);
    },
  });
}

export function useEnabledProviders() {
  return useQuery({
    queryKey: keys.providersEnabled(),
    queryFn: ({ signal }) => getJson<EnabledProvider[]>("/providers/enabled", { signal }),
  });
}

export function useCorsOrigins() {
  return useQuery({
    queryKey: keys.corsOrigins(),
    queryFn: ({ signal }) => getJson<string[]>("/settings/cors", { signal }),
  });
}

export function useSetCorsOrigins() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (origins: string[]) => patchJson<void>("/settings/cors", origins),
    onSuccess: () => afterCorsOriginsChange(qc),
  });
}

export function useInitConnection() {
  return useMutation({
    mutationFn: (providerKey: string) =>
      postJson<{ connectionId: string; redirectUrl: string | null }>(
        "/connections/init",
        { providerKey },
      ),
  });
}

export function useCompleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      connectionId,
      params,
    }: {
      connectionId: string;
      params: Record<string, string>;
    }) => postJson<void>("/connections/complete", { connectionId, params }),
    // A completed connect kicks an initial sync server-side, so the poll that
    // `afterSyncRequested` starts is what eventually refreshes the data views.
    onSuccess: () => afterSyncRequested(qc),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson<void>(`/connections/${id}`),
    // Deleting cascades to the connection's accounts and holdings immediately,
    // so every dashboard figure changes with it — not just the list.
    onSuccess: () => afterConnectionDeleted(qc),
  });
}

export function useCreateInvite() {
  return useMutation({
    mutationFn: () => postJson<{ token: string }>("/invites", {}),
  });
}

export function useCreateResetLink() {
  return useMutation({
    mutationFn: (id: string) => postJson<{ token: string }>(`/users/${id}/reset-link`, {}),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) =>
      deleteJson<void>(`/users/${id}`, { email }),
    onSuccess: () => afterUserChange(qc),
  });
}

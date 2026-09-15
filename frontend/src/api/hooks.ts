import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { deleteJson, getJson, patchJson, postJson, putJson } from "./client";
import type {
  Account,
  AccountSeries,
  AccountType,
  BasisPreview,
  DistributionAccount,
  EnabledProvider,
  Holding,
  Lot,
  NetWorthResponse,
  PricePoint,
  Provider,
  ProviderGroup,
  Session,
  SessionUser,
  Transaction,
  TransactionFilterQuery,
  User,
} from "./types";
import { hasSyncing } from "./types";
import { keys } from "./keys";
import {
  afterAccountEdit,
  afterConnectionDeleted,
  afterLotsSaved,
  afterSessionChange,
  afterSyncRequested,
  afterUserChange,
} from "./invalidate";

export type { TransactionFilterQuery };

export function useNetWorth(range: string) {
  return useQuery({
    queryKey: keys.netWorth(range),
    queryFn: () => getJson<NetWorthResponse>(`/dashboard/net-worth?range=${range}`),
    placeholderData: keepPreviousData,
  });
}

export type Health = { status: string; version: string };

export function useHealth() {
  return useQuery({
    queryKey: keys.health(),
    // The version cannot change without a page reload, so never refetch it.
    queryFn: () => getJson<Health>(`/health`),
    staleTime: Infinity,
  });
}

export function useDistribution() {
  return useQuery({
    queryKey: keys.distribution(),
    queryFn: () => getJson<DistributionAccount[]>(`/dashboard/distribution`),
  });
}

export function useHoldings() {
  return useQuery({
    queryKey: keys.holdings(),
    queryFn: () => getJson<Holding[]>(`/holdings`),
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
    queryFn: () => getJson<PricePoint[]>(`/holdings/${id}/prices?range=${range}`),
    placeholderData: keepPreviousData,
  });
}

export function useHoldingLots(id: string) {
  return useQuery({
    queryKey: keys.holdingLots(id),
    queryFn: () => getJson<Lot[]>(`/holdings/${id}/lots`),
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: keys.accounts(),
    queryFn: () => getJson<Account[]>(`/accounts`),
  });
}

export function useAccountSeries(range: string) {
  return useQuery({
    queryKey: keys.accountSeries(range),
    queryFn: () => getJson<AccountSeries>(`/accounts/series?range=${range}`),
    placeholderData: keepPreviousData,
  });
}

// The Transactions page is deliberately plain (§10): a load-more button over
// useInfiniteQuery's built-in page tracking, rather than a page-number UI or
// scroll-triggered fetching. Each page asks for PAGE_SIZE rows at `offset`;
// a page shorter than PAGE_SIZE means there is nothing left to fetch.
export const TRANSACTIONS_PAGE_SIZE = 200;

export function useTransactions(q: TransactionFilterQuery) {
  return useInfiniteQuery({
    queryKey: keys.transactions(q),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (q.search) params.set("search", q.search);
      if (q.accountId) params.set("accountId", q.accountId);
      if (q.type) params.set("type", q.type);
      if (q.from) params.set("from", q.from);
      if (q.to) params.set("to", q.to);
      params.set("limit", String(TRANSACTIONS_PAGE_SIZE));
      params.set("offset", String(pageParam));
      return getJson<Transaction[]>(`/transactions?${params}`);
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

export function useAccountTypes() {
  return useQuery({
    queryKey: keys.accountTypes(),
    queryFn: () => getJson<AccountType[]>(`/account-types`),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: keys.users(),
    queryFn: () => getJson<User[]>(`/users`),
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
    queryFn: () => getJson<Session[]>("/auth/sessions"),
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
  return useQuery({
    queryKey: keys.connections(),
    queryFn: () => getJson<ProviderGroup[]>("/connections"),
    // Poll while any connection is syncing; stop when none are.
    refetchInterval: (query) =>
      hasSyncing(query.state.data as ProviderGroup[] | undefined) ? 2000 : false,
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
    queryFn: () => getJson<Provider[]>("/providers"),
  });
}

export function useSetProviderEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      patchJson<Provider>(`/providers/${key}`, { enabled }),
    // Optimistically flip the toggle; roll back on error.
    onMutate: async ({ key, enabled }) => {
      await qc.cancelQueries({ queryKey: keys.providers() });
      const prev = qc.getQueryData<Provider[]>(keys.providers());
      qc.setQueryData<Provider[]>(keys.providers(), (old) =>
        old?.map((p) => (p.key === key ? { ...p, enabled } : p)),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.providers(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.providers() }),
  });
}

export function useEnabledProviders() {
  return useQuery({
    queryKey: keys.providersEnabled(),
    queryFn: () => getJson<EnabledProvider[]>("/providers/enabled"),
  });
}

export function useCorsOrigins() {
  return useQuery({
    queryKey: keys.corsOrigins(),
    queryFn: () => getJson<string[]>("/settings/cors"),
  });
}

export function useSetCorsOrigins() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (origins: string[]) => patchJson<void>("/settings/cors", origins),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.corsOrigins() }),
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

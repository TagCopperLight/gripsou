import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { deleteJson, getJson, patchJson, postJson } from "./client";
import type {
  Account,
  AccountSeries,
  AccountType,
  DistributionAccount,
  EnabledProvider,
  Holding,
  NetWorthResponse,
  PricePoint,
  Provider,
  ProviderGroup,
  Purchase,
  Session,
  SessionUser,
  User,
} from "./types";
import { hasSyncing } from "./types";

export function useNetWorth(range: string) {
  return useQuery({
    queryKey: ["net-worth", range],
    queryFn: () => getJson<NetWorthResponse>(`/dashboard/net-worth?range=${range}`),
    placeholderData: keepPreviousData,
  });
}

export function useDistribution() {
  return useQuery({
    queryKey: ["distribution"],
    queryFn: () => getJson<DistributionAccount[]>(`/dashboard/distribution`),
  });
}

export function useHoldings() {
  return useQuery({
    queryKey: ["holdings"],
    queryFn: () => getJson<Holding[]>(`/holdings`),
  });
}

export function useHoldingPrices(id: string, range: string) {
  return useQuery({
    queryKey: ["holding-prices", id, range],
    queryFn: () => getJson<PricePoint[]>(`/holdings/${id}/prices?range=${range}`),
    placeholderData: keepPreviousData,
  });
}

export function useHoldingTransactions(id: string) {
  return useQuery({
    queryKey: ["holding-transactions", id],
    queryFn: () => getJson<Purchase[]>(`/holdings/${id}/transactions`),
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => getJson<Account[]>(`/accounts`),
  });
}

export function useAccountSeries(range: string) {
  return useQuery({
    queryKey: ["account-series", range],
    queryFn: () => getJson<AccountSeries>(`/accounts/series?range=${range}`),
    placeholderData: keepPreviousData,
  });
}

export function useAccountTypes() {
  return useQuery({
    queryKey: ["account-types"],
    queryFn: () => getJson<AccountType[]>(`/account-types`),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
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
    onSuccess: () => {
      // Color/type changes ripple into the list, the distribution pie, and the
      // accounts stacked-area chart.
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["distribution"] });
      qc.invalidateQueries({ queryKey: ["account-series"] });
    },
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
      qc.invalidateQueries({ queryKey: ["users"] });
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
      qc.invalidateQueries({ queryKey: ["sessions"] });
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
    queryKey: ["sessions"],
    queryFn: () => getJson<Session[]>("/auth/sessions"),
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson<void>(`/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteJson<void>("/auth/sessions"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
}

export function useConnections() {
  return useQuery({
    queryKey: ["connections"],
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }),
  });
}

export function useSyncAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => postJson<void>("/sync", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }),
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
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
      await qc.cancelQueries({ queryKey: ["providers"] });
      const prev = qc.getQueryData<Provider[]>(["providers"]);
      qc.setQueryData<Provider[]>(["providers"], (old) =>
        old?.map((p) => (p.key === key ? { ...p, enabled } : p)),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["providers"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["providers"] }),
  });
}

export function useEnabledProviders() {
  return useQuery({
    queryKey: ["providers-enabled"],
    queryFn: () => getJson<EnabledProvider[]>("/providers/enabled"),
  });
}

export function useCorsOrigins() {
  return useQuery({
    queryKey: ["cors-origins"],
    queryFn: () => getJson<string[]>("/settings/cors"),
  });
}

export function useSetCorsOrigins() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (origins: string[]) => patchJson<void>("/settings/cors", origins),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cors-origins"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteJson<void>(`/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connections"] }),
  });
}

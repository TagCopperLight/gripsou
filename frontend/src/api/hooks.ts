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
  Holding,
  NetWorthResponse,
  PricePoint,
  Purchase,
  Session,
  User,
} from "./types";

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

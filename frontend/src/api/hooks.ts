import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { getJson, patchJson } from "./client";
import type {
  Account,
  AccountSeries,
  AccountType,
  DistributionAccount,
  Holding,
  NetWorthResponse,
  PricePoint,
  Purchase,
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

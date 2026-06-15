import { useQuery } from "@tanstack/react-query";
import { getJson } from "./client";
import type {
  Account,
  AccountSeries,
  DistributionAccount,
  Holding,
  NetWorthResponse,
  PricePoint,
  Purchase,
} from "./types";

export function useNetWorth(range: string) {
  return useQuery({
    queryKey: ["net-worth", range],
    queryFn: () => getJson<NetWorthResponse>(`/dashboard/net-worth?range=${range}`),
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
  });
}

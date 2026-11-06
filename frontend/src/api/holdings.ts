import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson, putJson } from "./client";
import type { BasisPreview, Holding, InvestmentReturns, Lot, LotSuggestion, PricePoint } from "./types";
import { keys } from "./keys";
import { afterLotsSaved } from "./invalidate";
import { PORTFOLIO_STALE_MS } from "./accounts";

export function useHoldings() {
  return useQuery({
    queryKey: keys.holdings(),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => getJson<Holding[]>(`/holdings`, { signal }),
  });
}

export function useInvestmentReturns() {
  return useQuery({
    queryKey: keys.investmentReturns(),
    staleTime: PORTFOLIO_STALE_MS,
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

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson, putJson } from "./client";
import type {
  BasisPreview,
  Holding,
  InvestmentReturns,
  Lot,
  LotEntry,
  LotSuggestion,
  PricePoint,
  Range,
  SaveLotsReq,
} from "./wire";
import { keys } from "./keys";
import { afterLotsSaved } from "./invalidate";
import { PORTFOLIO_STALE_MS } from "./accounts";
import { fxExcludedCount } from "../lib/holdings";

export function useHoldings() {
  return useQuery({
    queryKey: keys.holdings(),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => getJson<Holding[]>(`/holdings`, { signal }),
  });
}

/** How many holdings (of `accountIds`, else all) the converted totals leave
 *  out for want of a rate; 0 until the holdings have loaded. */
export function useFxExcludedCount(accountIds?: ReadonlySet<string>): number {
  const { data } = useHoldings();
  return fxExcludedCount((data ?? []).filter((h) => !accountIds || accountIds.has(h.accountId)));
}

export function useInvestmentReturns() {
  return useQuery({
    queryKey: keys.investmentReturns(),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => getJson<InvestmentReturns>(`/investments/returns`, { signal }),
  });
}

export function useLotsPreview(id: string) {
  return useMutation({
    mutationFn: (rows: LotEntry[]) =>
      postJson<BasisPreview>(`/holdings/${id}/lots/preview`, { rows }),
  });
}

export function useSaveLots(holdingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batch: SaveLotsReq) =>
      putJson<void>(`/holdings/${holdingId}/lots`, batch),
    onSuccess: () => afterLotsSaved(qc, holdingId),
  });
}

export function useHoldingPrices(id: string, range: Range) {
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

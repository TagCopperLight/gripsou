import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { LotEntry, Range, SaveLotsReq } from "./wire";
import { keys } from "./keys";
import { afterLotsSaved } from "./invalidate";
import { PORTFOLIO_STALE_MS } from "./accounts";
import { fxExcludedCount } from "../lib/holdings";

export function useHoldings() {
  return useQuery({
    queryKey: keys.holdings(),
    staleTime: PORTFOLIO_STALE_MS,
    queryFn: ({ signal }) => api("GET /holdings", { signal }),
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
    queryFn: ({ signal }) => api("GET /investments/returns", { signal }),
  });
}

export function useLotsPreview(id: string) {
  return useMutation({
    mutationFn: (rows: LotEntry[]) =>
      api("POST /holdings/:id/lots/preview", { params: { id }, body: { rows } }),
  });
}

export function useSaveLots(holdingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batch: SaveLotsReq) =>
      api("PUT /holdings/:id/lots", { params: { id: holdingId }, body: batch }),
    onSuccess: () => afterLotsSaved(qc, holdingId),
  });
}

export function useHoldingPrices(id: string, range: Range) {
  return useQuery({
    queryKey: keys.holdingPrices(id, range),
    queryFn: ({ signal }) => api("GET /holdings/:id/prices", { params: { id }, query: { range }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useHoldingLots(id: string) {
  return useQuery({
    queryKey: keys.holdingLots(id),
    queryFn: ({ signal }) => api("GET /holdings/:id/lots", { params: { id }, signal }),
  });
}

export function useLotSuggestions(id: string) {
  return useQuery({
    queryKey: keys.holdingLotSuggestions(id),
    retry: false, // suggestions are optional: fall back to the empty form fast
    queryFn: ({ signal }) => api("GET /holdings/:id/lots/suggestions", { params: { id }, signal }),
  });
}

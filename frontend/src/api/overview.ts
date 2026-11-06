import { calendarDay } from "../lib/date";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

import { api } from "./client";
import { keys } from "./keys";
import type { SummaryParams } from "./wire";
import { currentMonth, periodBounds, type Period } from "../lib/period";

function summaryParams(period: Period): SummaryParams {
  // Either `month` or `from`+`to`, never both and never neither — the server
  // answers 400 on anything else, on purpose.
  if (period.mode === "month") return { month: period.month };
  const { from, to } = periodBounds(period);
  return { from, to };
}

export function useBudgetSummary(period: Period) {
  return useQuery({
    queryKey: keys.budgetSummary(period),
    queryFn: ({ signal }) => api("GET /budget/summary", { query: summaryParams(period), signal }),
    // Stepping a month keeps the old numbers on screen until the new ones land,
    // instead of flashing every surface through its loading state.
    placeholderData: keepPreviousData,
  });
}

/** The "last twelve months" surface. The window ends at AND INCLUDES `anchor`,
 *  which is deliberately not the same window as a figure's `avg12` — that one
 *  is the twelve months BEFORE the selected one, excluding it. They overlap in
 *  eleven; this is not a bug to reconcile. */
export function useBudgetTrend(anchor: string) {
  return useQuery({
    queryKey: keys.budgetTrend(anchor),
    queryFn: ({ signal }) => api("GET /budget/trend", { query: { anchor, months: 12 }, signal }),
    placeholderData: keepPreviousData,
  });
}

/** The month of the newest transaction the list shows by default — paired
 *  transfers left out, as the summary leaves them out — which is where the
 *  Overview opens and how far forward it steps. Capped at the current month,
 *  so a row dated ahead cannot open the page on the future; `null` when there
 *  are no transactions at all. */
export function useLatestDataMonth() {
  return useQuery({
    queryKey: keys.budgetLatestMonth(),
    queryFn: async ({ signal }) => {
      const rows = await api("GET /transactions", { query: { limit: 1 }, signal });
      if (rows.length === 0) return null;
      const latest = calendarDay(rows[0].t).slice(0, 7);
      const now = currentMonth();
      return latest < now ? latest : now;
    },
  });
}


import { calendarDay } from "../lib/date";
import { useQuery, keepPreviousData, skipToken } from "@tanstack/react-query";

import { api } from "./client";
import { keys } from "./keys";
import { TREND_MONTHS_DEFAULT, type SummaryParams } from "./wire";
import { currentMonth, periodBounds, type Period } from "../lib/period";

function summaryParams(period: Period): SummaryParams {
  // Either `month` or `from`+`to`, never both and never neither: the server answers 400.
  if (period.mode === "month") return { month: period.month };
  const { from, to } = periodBounds(period);
  return { from, to };
}

export function useBudgetSummary(period: Period | undefined) {
  return useQuery({
    queryKey: keys.budgetSummary(period),
    queryFn: period === undefined
      ? skipToken
      : ({ signal }) => api("GET /budget/summary", { query: summaryParams(period), signal }),
    // Keeps the old numbers on screen while stepping months instead of flashing loading states.
    placeholderData: keepPreviousData,
  });
}

/** The window ends at and includes `anchor`, unlike a figure's `avg12` (the twelve months before
 *  the selected one). The overlap is intended. */
export function useBudgetTrend(anchor: string | undefined) {
  return useQuery({
    queryKey: keys.budgetTrend(anchor),
    queryFn: anchor === undefined
      ? skipToken
      : ({ signal }) => api("GET /budget/trend", { query: { anchor, months: TREND_MONTHS_DEFAULT }, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Capped at the current month; `null` when there are no transactions. Paired transfers are left
 *  out, as in the summary. */
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


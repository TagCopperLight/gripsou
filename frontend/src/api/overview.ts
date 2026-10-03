import { useQuery, keepPreviousData } from "@tanstack/react-query";

import { getJson } from "./client";
import { keys } from "./keys";
import { transactionFilterParams } from "./filter";
import type { BudgetCategory } from "./budget";
import type { Transaction, TransactionCounts, TransactionFilterQuery } from "./types";
import { addMonths, currentMonth, monthBounds, periodBounds, type Period } from "../lib/period";

/** The chip fields, and no more — the same shape `/api/transactions` rows carry,
 *  so `CategoryChip` renders one of these unchanged. */
export type CategoryRef = Pick<BudgetCategory, "id" | "name" | "defaultKey" | "color" | "icon">;

/** One union for the Sankey's nodes, the breakdown's rows and the trend's
 *  series. Note the -s- in `uncategorised`: that is what the server sends. */
export type Slice =
  | { kind: "category"; category: CategoryRef }
  | { kind: "uncategorised" }
  | { kind: "other" };

/** `amount` is always a POSITIVE magnitude — the direction is
 *  carried by which list the entry is in, never by its sign. */
export type SliceAmount = { slice: Slice; amount: string };

/** `prevMonth` and `avg12` are ABSENT, not null, when they do not apply: a
 *  date range has neither, and neither does a month with under three months
 *  of history before it. `avg12` comes rounded by the server. */
export type Figure = { amount: string; prevMonth?: string; avg12?: string };

export type BreakdownRow = {
  slice: Slice;
  amount: string;
  txnCount: number;
  /** Always absent on the `other` row, whose membership changes month to month. */
  avg12?: string;
};

export type Sankey = {
  sources: SliceAmount[];
  /** At most 8 entries plus `other`, which, when present, is always last. */
  destinations: SliceAmount[];
  /** Neither field appears in `sources`/`destinations`; at a remainder of
   *  exactly zero NEITHER is present. Three states, not two. */
  notSpent?: string;
  drawnFromSavings?: string;
};

export type BudgetSummary = {
  /** NOT the transactions list's count for the same month: it leaves out lot
   *  rows (purchases/sales), which the list shows. The two differing is
   *  expected. */
  txnCount: number;
  /** Some row could not be valued — the figures are UNDERSTATED. */
  fxMissing: boolean;
  /** Nothing is missing; the whole sum is in the PIVOT currency, so it must not
   *  be labelled with the reader's reporting symbol as if converted. */
  reportingFxMissing: boolean;
  figures: { income: Figure; expenses: Figure; net: Figure };
  sankey: Sankey;
  /** Expense side only: expense-kind categories plus the uncategorised OUTFLOW
   *  row. The 7 largest plus one rolled-up `other`; the rolled-up members are
   *  not sent, which is why `other` does not expand. */
  breakdown: BreakdownRow[];
};

export type TrendSeries = { slice: Slice; values: string[] };
/** Every series has one value per month, zeros included, so nothing here needs
 *  sparse-array alignment. */
export type BudgetTrend = { months: string[]; series: TrendSeries[] };

function summaryParams(period: Period): string {
  // Either `month` or `from`+`to`, never both and never neither — the server
  // answers 400 on anything else, on purpose.
  if (period.mode === "month") return `month=${period.month}`;
  const { from, to } = periodBounds(period);
  return `from=${from}&to=${to}`;
}

export function useBudgetSummary(period: Period) {
  return useQuery({
    queryKey: keys.budgetSummary(period),
    queryFn: () => getJson<BudgetSummary>(`/budget/summary?${summaryParams(period)}`),
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
    queryFn: () => getJson<BudgetTrend>(`/budget/trend?anchor=${anchor}&months=12`),
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
    queryFn: async () => {
      const rows = await getJson<Transaction[]>("/transactions?limit=1");
      if (rows.length === 0) return null;
      const latest = currentMonth(new Date(rows[0].t));
      const now = currentMonth();
      return latest < now ? latest : now;
    },
  });
}

/** Whether any transaction is dated before `month`, which is whether the
 *  Overview can step back from it. An empty month in the middle of the data
 *  is not its edge. Nothing is asked while `month` is undefined. */
export function useHasDataBefore(month: string | undefined) {
  const q: TransactionFilterQuery = {
    to: month === undefined ? undefined : monthBounds(addMonths(month, -1)).to,
  };
  return useQuery({
    // The counts' own key, so it refreshes with every other count.
    queryKey: keys.transactionCounts(q),
    queryFn: () => getJson<TransactionCounts>(`/transactions/counts?${transactionFilterParams(q)}`),
    enabled: month !== undefined,
    select: (c) => c.matching > 0,
    placeholderData: keepPreviousData,
  });
}

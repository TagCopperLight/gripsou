import { useQuery, keepPreviousData } from "@tanstack/react-query";

import { getJson } from "./client";
import { keys } from "./keys";
import type { BudgetCategory } from "./budget";
import { periodBounds, type Period } from "../lib/period";

/** The chip fields, and no more — the same shape `/api/transactions` rows carry,
 *  so `CategoryChip` renders one of these unchanged. */
export type CategoryRef = Pick<
  BudgetCategory,
  "id" | "name" | "defaultKey" | "color" | "icon" | "kind"
>;

/** One union for the Sankey's nodes, the breakdown's rows and the trend's
 *  series. Note the -s- in `uncategorised`: that is what the server sends. */
export type Slice =
  | { kind: "category"; category: CategoryRef }
  | { kind: "uncategorised" }
  | { kind: "other" };

/** `amount` is always a POSITIVE magnitude (handoff trap 10) — the direction is
 *  carried by which list the entry is in, never by its sign. */
export type SliceAmount = { slice: Slice; amount: string };

/** `prevMonth` and `avg12` are ABSENT, not null, when they do not apply
 *  (handoff trap 2). Their presence is independent of `comparable` (trap 1):
 *  a month with under three months of history is `comparable: true` with both
 *  keys missing. */
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
  /** Can exceed 8 entries: the 2%/8 collapse exempts `internal` branches
   *  (savings, investments) on purpose. `other`, when present, is always last. */
  destinations: SliceAmount[];
  /** Neither field appears in `sources`/`destinations`; at a remainder of
   *  exactly zero NEITHER is present. Three states, not two. */
  notSpent?: string;
  drawnFromSavings?: string;
};

export type BudgetSummary = {
  currency: string;
  /** NOT the transactions list's count for the same month: it includes paired
   *  internal transfers the list hides and excludes lot rows the list shows
   *  (handoff trap 7). The two differing is expected. */
  txnCount: number;
  /** Some row could not be valued — the figures are UNDERSTATED. */
  fxMissing: boolean;
  /** Nothing is missing; the whole sum is in the PIVOT currency, so it must not
   *  be labelled with the reader's reporting symbol as if converted. */
  reportingFxMissing: boolean;
  /** True exactly when the period was sent as a month. */
  comparable: boolean;
  figures: { income: Figure; expenses: Figure; net: Figure; saved: Figure };
  sankey: Sankey;
  /** Expense side only: expense-kind categories plus the uncategorised OUTFLOW
   *  row. The 7 largest plus one rolled-up `other`; the rolled-up members are
   *  not sent, which is why `other` does not expand (addendum §1). */
  breakdown: BreakdownRow[];
  expensesTotal: string;
};

export type TrendSeries = { slice: Slice; values: string[] };
/** Every series has one value per month, zeros included, so nothing here needs
 *  sparse-array alignment. */
export type BudgetTrend = { months: string[]; series: TrendSeries[] };

function summaryParams(period: Period): string {
  // Either `month` or `from`+`to`, never both and never neither — the server
  // answers 400 on anything else, on purpose (handoff §2).
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

/** `months` must be 1..=24; the server 400s outside that. The default of 12 is
 *  the "last twelve months" surface. The window ends at AND INCLUDES `anchor`,
 *  which is deliberately not the same window as a figure's `avg12` — that one
 *  is the twelve months BEFORE the selected one, excluding it. They overlap in
 *  eleven; this is not a bug to reconcile (handoff trap 9). */
export function useBudgetTrend(anchor: string, months = 12) {
  return useQuery({
    queryKey: keys.budgetTrend(anchor, months),
    queryFn: () => getJson<BudgetTrend>(`/budget/trend?anchor=${anchor}&months=${months}`),
    placeholderData: keepPreviousData,
  });
}

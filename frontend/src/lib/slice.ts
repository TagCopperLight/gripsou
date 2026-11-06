import type { TFunction } from "i18next";

import type { BreakdownRow, Slice } from "../api/overview";
import {
  FALLBACK_COLOR, UNCATEGORISED_COLOR, categoryLabel, safeBudgetColor, type CategoryLike,
} from "./budget";

/** Neutral, so a rollup recedes behind the real categories beside it. */
const OTHER_COLOR = FALLBACK_COLOR;

/** A stable identity for a slice, for React keys and chart node names. The two
 *  singletons key by kind; a category keys by id, so a rename or recolour does
 *  not restart its animation. */
export function sliceKey(s: Slice): string {
  if (s.kind === "category") return `cat:${s.category.id}`;
  return s.kind;
}

export function sliceColor(s: Slice): string {
  if (s.kind === "category") return safeBudgetColor(s.category.color);
  return s.kind === "uncategorised" ? UNCATEGORISED_COLOR : OTHER_COLOR;
}

export function sliceLabel(t: TFunction, s: Slice): string {
  if (s.kind === "category") return categoryLabel(t, s.category);
  return s.kind === "uncategorised" ? t("budget.uncategorized") : t("budget.overview.other");
}

/** What `CategoryChip` should be handed for a slice. `uncategorised` maps to
 *  `null`, which is the chip's existing no-category state — amber, labelled
 *  from `budget.uncategorized`. `other` has no category behind it at all, so a
 *  minimal neutral one is synthesised for display only; it is never written
 *  anywhere and carries no id. */
export function sliceChip(t: TFunction, s: Slice): CategoryLike | null {
  if (s.kind === "category") return s.category;
  if (s.kind === "uncategorised") return null;
  return {
    name: t("budget.overview.other"),
    defaultKey: null,
    color: OTHER_COLOR,
    icon: null,
  };
}

export type BreakdownSortKey = "category" | "amount" | "txnCount";
export type BreakdownSort = { key: BreakdownSortKey; asc: boolean };

/** Like the holdings table: a new column starts in its natural direction (A→Z
 *  for names, largest first for figures), a second click flips. */
export function toggleBreakdownSort(prev: BreakdownSort, key: BreakdownSortKey): BreakdownSort {
  return prev.key === key ? { key, asc: !prev.asc } : { key, asc: key === "category" };
}

/** The breakdown's rows in table order. `other` is a rollup, not a peer: it
 *  stays last however the real rows are ordered, so the table always reads
 *  "…and everything else". Names sort by `sliceLabel`, so uncategorised sits
 *  among the categories by its displayed label. */
export function sortBreakdown(t: TFunction, rows: BreakdownRow[], sort: BreakdownSort): BreakdownRow[] {
  const dir = sort.asc ? 1 : -1;
  const real = rows.filter((r) => r.slice.kind !== "other");
  const rollup = rows.filter((r) => r.slice.kind === "other");
  real.sort((a, b) => {
    switch (sort.key) {
      case "category":
        return dir * sliceLabel(t, a.slice).localeCompare(sliceLabel(t, b.slice));
      case "txnCount":
        return dir * (a.txnCount - b.txnCount);
      default:
        return dir * (Number(a.amount) - Number(b.amount));
    }
  });
  return [...real, ...rollup];
}

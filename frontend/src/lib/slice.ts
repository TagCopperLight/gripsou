import type { TFunction } from "i18next";

import type { BreakdownRow, Slice } from "../api/wire";
import {
  FALLBACK_COLOR, UNCATEGORISED_COLOR, categoryLabel, safeBudgetColor, type CategoryLike,
} from "./budget";

const OTHER_COLOR = FALLBACK_COLOR;

/** Singletons key by kind, a category by id so a rename or recolour keeps its animation. */
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

/** `uncategorised` maps to `null`, the chip's no-category state. `other` has no
 *  category, so a minimal neutral one is made for display only. */
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

export function toggleBreakdownSort(prev: BreakdownSort, key: BreakdownSortKey): BreakdownSort {
  return prev.key === key ? { key, asc: !prev.asc } : { key, asc: key === "category" };
}

/** `other` is a rollup and stays last whatever the order. */
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

import type { TFunction } from "i18next";

import type { CategoryRef, Slice } from "../api/overview";
import { FALLBACK_COLOR, categoryLabel, safeBudgetColor, type CategoryLike } from "./budget";

/** What `CategoryChip` already paints a row with no category. */
export const UNCATEGORISED_COLOR = "#f0b952";
/** Neutral, so a rollup recedes behind the real categories beside it. */
export const OTHER_COLOR = FALLBACK_COLOR;

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

/** The category behind a slice, or `null` for the two singletons — which is
 *  also the test for "can this row deep-link on a category id?". */
export function sliceCategory(s: Slice): CategoryRef | null {
  return s.kind === "category" ? s.category : null;
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

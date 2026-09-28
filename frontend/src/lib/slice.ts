import type { TFunction } from "i18next";

import type { Slice } from "../api/overview";
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

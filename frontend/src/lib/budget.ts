import type { TFunction } from "i18next";

import type { BudgetCategory, CategoryKind, Transaction } from "../api/wire";
import { AMBER, FG_DIM } from "./theme";

/** Display order of the three kinds; also the grouping order of every list. */
export const BUDGET_KINDS: readonly CategoryKind[] = ["expense", "income", "neutral"];

/** The fallback for a missing or unsafe colour. A colour reaches an inline
 *  `style`, so it is validated, not trusted. */
export const FALLBACK_COLOR = FG_DIM;
/** A row with no category: amber, like the "needs review" text beside it. */
export const UNCATEGORISED_COLOR = AMBER;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function safeBudgetColor(color: string | null | undefined): string {
  return color && HEX.test(color) ? color : FALLBACK_COLOR;
}

/** Seeded rows are translated; a renamed row is the user's own text, shown
 *  verbatim even if it happens to equal a translation key. */
export function categoryLabel(
  t: TFunction,
  c: Pick<BudgetCategory, "name" | "defaultKey">,
): string {
  return c.defaultKey ? t(`budget.defaults.${c.defaultKey}`, { defaultValue: c.name }) : c.name;
}

/** Everything `CategoryChip` reads, and nothing more — so a full
 *  `BudgetCategory` and the leaner `CategoryRef` the Overview endpoints send
 *  both satisfy it. Declared here rather than in the component file: eslint's
 *  react-refresh rule forbids a non-component export from a `.tsx`. */
export type CategoryLike = Pick<BudgetCategory, "name" | "defaultKey" | "color" | "icon">;

/** Kind-major, and nothing more: inside a kind the backend's `sort_order` is
 *  the order the user arranged by hand, and `Array.prototype.sort` is stable,
 *  so it survives. */
export function sortCategories(list: BudgetCategory[]): BudgetCategory[] {
  return [...list].sort(
    (a, b) => BUDGET_KINDS.indexOf(a.kind) - BUDGET_KINDS.indexOf(b.kind),
  );
}

type Orderable = Pick<BudgetCategory, "id" | "kind">;

/** The row a category's arrow would trade places with: the previous/next row
 *  of its kind that is on screen. `undefined` at that end of its kind, where
 *  the arrow is dead. */
export function categoryNeighbour<C extends Orderable>(visible: C[], c: C, dir: -1 | 1): C | undefined {
  const siblings = visible.filter((r) => r.kind === c.kind);
  return siblings[siblings.findIndex((r) => r.id === c.id) + dir];
}

/** Every id, in order, once `c` moves past its visible neighbour; null when it
 *  has none. Hidden archived rows are carried along rather than stepped on: the
 *  row lands where the neighbour was in the *full* kind list, so the arrow
 *  always moves it exactly one visible place. `rows` is the full list in
 *  `sortCategories` order. */
export function categoryOrderAfterMove(rows: Orderable[], visible: Orderable[], c: Orderable, dir: -1 | 1): string[] | null {
  const target = categoryNeighbour(visible, c, dir);
  if (!target) return null;
  const kindRows = rows.filter((r) => r.kind === c.kind);
  const to = kindRows.findIndex((r) => r.id === target.id);
  const moved = kindRows.filter((r) => r.id !== c.id);
  // `to` still addresses the right slot after the removal: moving up, the
  // rows before it did not shift; moving down, the neighbour slid one place
  // left, so inserting at `to` puts `c` just after it.
  moved.splice(to, 0, c);
  return BUDGET_KINDS.flatMap((k) => (k === c.kind ? moved : rows.filter((r) => r.kind === k))).map((r) => r.id);
}

/** The row's own category, as much of it as the chip draws — rebuilt from
 *  the flat fields the list endpoint sends. Nothing is invented: a row does not
 *  carry its category's kind, hint or archive flag, so neither does this. */
export function categoryOfTransaction(tx: Transaction): CategoryLike | null {
  if (!tx.categoryId) return null;
  return {
    name: tx.categoryName ?? "",
    defaultKey: tx.categoryDefaultKey,
    color: tx.categoryColor ?? "",
    icon: tx.categoryIcon,
  };
}

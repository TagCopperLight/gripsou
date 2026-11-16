import type { TFunction } from "i18next";

import type { BudgetCategory, CategoryKind, Transaction } from "../api/wire";
import { AMBER, FG_DIM } from "./theme";

export const BUDGET_KINDS: readonly CategoryKind[] = ["expense", "income", "neutral"];

/** A colour reaches an inline `style`, so it is validated, not trusted. */
export const FALLBACK_COLOR = FG_DIM;
export const UNCATEGORISED_COLOR = AMBER;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function safeBudgetColor(color: string | null | undefined): string {
  return color && HEX.test(color) ? color : FALLBACK_COLOR;
}

/** A renamed row is the user's own text, shown verbatim even if it equals a translation key. */
export function categoryLabel(
  t: TFunction,
  c: Pick<BudgetCategory, "name" | "defaultKey">,
): string {
  return c.defaultKey ? t(`budget.defaults.${c.defaultKey}`, { defaultValue: c.name }) : c.name;
}

/** Declared here, not in the component file: eslint's react-refresh rule forbids a non-component export from a `.tsx`. */
export type CategoryLike = Pick<BudgetCategory, "name" | "defaultKey" | "color" | "icon">;

/** Inside a kind the backend's `sort_order` is the user's order; `Array.prototype.sort` is stable, so it survives. */
export function sortCategories(list: BudgetCategory[]): BudgetCategory[] {
  return [...list].sort(
    (a, b) => BUDGET_KINDS.indexOf(a.kind) - BUDGET_KINDS.indexOf(b.kind),
  );
}

type Orderable = Pick<BudgetCategory, "id" | "kind">;

export function categoryNeighbour<C extends Orderable>(visible: C[], c: C, dir: -1 | 1): C | undefined {
  const siblings = visible.filter((r) => r.kind === c.kind);
  return siblings[siblings.findIndex((r) => r.id === c.id) + dir];
}

/** Hidden archived rows are carried along: the row lands where the neighbour was in the full kind list, so the arrow moves it exactly one visible place. `rows` is in `sortCategories` order. */
export function categoryOrderAfterMove(rows: Orderable[], visible: Orderable[], c: Orderable, dir: -1 | 1): string[] | null {
  const target = categoryNeighbour(visible, c, dir);
  if (!target) return null;
  const kindRows = rows.filter((r) => r.kind === c.kind);
  const to = kindRows.findIndex((r) => r.id === target.id);
  const moved = kindRows.filter((r) => r.id !== c.id);
  // `to` still addresses the right slot after removal: moving up nothing before it shifted; moving down the neighbour slid left.
  moved.splice(to, 0, c);
  return BUDGET_KINDS.flatMap((k) => (k === c.kind ? moved : rows.filter((r) => r.kind === k))).map((r) => r.id);
}

export function categoryOfTransaction(tx: Transaction): CategoryLike | null {
  if (!tx.categoryId) return null;
  return {
    name: tx.categoryName ?? "",
    defaultKey: tx.categoryDefaultKey,
    color: tx.categoryColor ?? "",
    icon: tx.categoryIcon,
  };
}

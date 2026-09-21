import { createContext, useContext } from "react";

import type { BudgetFilters } from "../../lib/budgetFilters";

/** "All shown" is a *mode*, never an expanded id list: §2.1 defines it as
 *  everything matching the active filters, which with no filter is 3.5 years
 *  of rows. The bulk endpoint takes a `filter` body for exactly this reason. */
export type Selection =
  | { mode: "ids"; ids: ReadonlySet<string> }
  | { mode: "allShown" };

export type BudgetContextValue = {
  filters: BudgetFilters;
  setFilters: (next: BudgetFilters) => void;
  patchFilters: (
    patch: Partial<BudgetFilters> | ((prev: BudgetFilters) => Partial<BudgetFilters>),
  ) => void;
  selection: Selection;
  isSelected: (id: string) => boolean;
  toggleRow: (id: string) => void;
  selectAllShown: () => void;
  clearSelection: () => void;
  anySelected: boolean;
};

export const BudgetContext = createContext<BudgetContextValue | null>(null);

export function useBudget(): BudgetContextValue {
  const value = useContext(BudgetContext);
  if (!value) throw new Error("useBudget must be used inside a BudgetProvider");
  return value;
}

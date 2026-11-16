import { createContext, useContext } from "react";

import type { BudgetFilters } from "../../lib/budgetFilters";
import type { Period } from "../../lib/period";

/** "All shown" is a mode, never an expanded id list: with no filter that is 3.5 years of rows, so the
 *  bulk endpoint takes a `filter` body. */
export type Selection =
  | { mode: "ids"; ids: ReadonlySet<string> }
  | { mode: "allShown" };

type BudgetContextValue = {
  filters: BudgetFilters;
  setFilters: (next: BudgetFilters) => void;
  patchFilters: (
    patch: Partial<BudgetFilters> | ((prev: BudgetFilters) => Partial<BudgetFilters>),
  ) => void;
  /** Overview's period, kept out of the URL so it survives a mode switch. `null` until picked: the
   *  Overview then shows the latest month with transactions, which only the server knows. */
  period: Period | null;
  setPeriod: (p: Period | null) => void;
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

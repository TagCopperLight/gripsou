import { useCallback, useMemo, useState, type ReactNode } from "react";

import { BudgetContext, type Selection } from "./budgetContext";
import { EMPTY_FILTERS, type BudgetFilters } from "../../lib/budgetFilters";
import type { Period } from "../../lib/period";

const NOTHING: Selection = { mode: "ids", ids: new Set<string>() };

/** Lives above the mode outlet so filters survive a mode switch and reset on leaving the page. */
export function BudgetProvider({ children }: { children: ReactNode }) {
  const [filters, setFiltersState] = useState<BudgetFilters>(EMPTY_FILTERS);
  const [selection, setSelection] = useState<Selection>(NOTHING);
  const [period, setPeriod] = useState<Period | null>(null);

  // "All shown" would silently retarget a different set, and a hand-picked row could scroll out of the list while still counting towards a bulk write.
  const setFilters = useCallback((next: BudgetFilters) => {
    setFiltersState(next);
    setSelection(NOTHING);
  }, []);

  const patchFilters = useCallback(
    (
      patch: Partial<BudgetFilters> | ((prev: BudgetFilters) => Partial<BudgetFilters>),
    ) => {
      // Functional form: two patches batched in one tick would both read the same stale snapshot. Updater patches derive from current state.
      setFiltersState((prev) => ({
        ...prev,
        ...(typeof patch === "function" ? patch(prev) : patch),
      }));
      setSelection(NOTHING);
    },
    [],
  );

  const toggleRow = useCallback((id: string) => {
    setSelection((prev) => {
      // "All but this one" is not a set the bulk endpoint can express.
      const ids = new Set(prev.mode === "ids" ? prev.ids : []);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { mode: "ids", ids };
    });
  }, []);

  const selectAllShown = useCallback(() => setSelection({ mode: "allShown" }), []);
  const clearSelection = useCallback(() => setSelection(NOTHING), []);
  // Changes only with the selection, not with every keystroke in the search box.
  const isSelected = useCallback(
    (id: string) => selection.mode === "allShown" || selection.ids.has(id),
    [selection],
  );

  const value = useMemo(
    () => ({
      filters,
      setFilters,
      patchFilters,
      period,
      setPeriod,
      selection,
      isSelected,
      toggleRow,
      selectAllShown,
      clearSelection,
      anySelected: selection.mode === "allShown" || selection.ids.size > 0,
    }),
    [filters, setFilters, patchFilters, period, selection, isSelected, toggleRow, selectAllShown, clearSelection],
  );

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

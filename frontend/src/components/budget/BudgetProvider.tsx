import { useCallback, useMemo, useState, type ReactNode } from "react";

import { BudgetContext, type Selection } from "./budgetContext";
import { EMPTY_FILTERS, type BudgetFilters } from "../../lib/budgetFilters";

const NOTHING: Selection = { mode: "ids", ids: new Set<string>() };

/** Lives in the `/budget` layout route, above the mode outlet, so filters
 *  survive a mode switch within a visit (§2.5) and reset on leaving the page. */
export function BudgetProvider({ children }: { children: ReactNode }) {
  const [filters, setFiltersState] = useState<BudgetFilters>(EMPTY_FILTERS);
  const [selection, setSelection] = useState<Selection>(NOTHING);

  // Any filter change clears the selection. Without this, "all shown" would
  // silently retarget a different set between the user selecting and acting —
  // and a hand-picked row could scroll out of the filtered list while still
  // counting towards a bulk write.
  const setFilters = useCallback((next: BudgetFilters) => {
    setFiltersState(next);
    setSelection(NOTHING);
  }, []);

  const patchFilters = useCallback(
    (
      patch: Partial<BudgetFilters> | ((prev: BudgetFilters) => Partial<BudgetFilters>),
    ) => {
      // Functional form, not `{...filters, ...patch}`: two patches batched into
      // one tick would otherwise both read the same stale snapshot and the second
      // would silently discard the first. The updater-function form of `patch`
      // extends this to derived writes (e.g. toggling an id into an existing
      // list) so the derivation itself sees the current state, not a
      // pre-batch closure snapshot.
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
      // Picking a row out of "all shown" starts a fresh explicit selection —
      // "all but this one" is not a set the bulk endpoint can express.
      const ids = new Set(prev.mode === "ids" ? prev.ids : []);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return { mode: "ids", ids };
    });
  }, []);

  const value = useMemo(
    () => ({
      filters,
      setFilters,
      patchFilters,
      selection,
      isSelected: (id: string) =>
        selection.mode === "allShown" || selection.ids.has(id),
      toggleRow,
      selectAllShown: () => setSelection({ mode: "allShown" }),
      clearSelection: () => setSelection(NOTHING),
      anySelected: selection.mode === "allShown" || selection.ids.size > 0,
    }),
    [filters, setFilters, patchFilters, selection, toggleRow],
  );

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

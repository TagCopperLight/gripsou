import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, SlidersHorizontal } from "lucide-react";

import { useBudget } from "./budgetContext";
import { FilterPanel } from "./FilterPanel";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { Select } from "../Select";
import { useAccounts } from "../../api/hooks";
import { TIME_FRAMES, isFiltered, withTimeFrame } from "../../lib/budgetFilters";
import type { TransactionCounts } from "../../api/types";

/** The nested surface of §2.2: three parts, each rendered only when it has
 *  something to show. */
export function SearchSurface({ counts }: { counts?: TransactionCounts }) {
  const { t } = useTranslation();
  const { filters, patchFilters } = useBudget();
  const [panelOpen, setPanelOpen] = useState(false);
  const accounts = useAccounts().data ?? [];

  return (
    <div className="relative rounded-xl bg-surface-2/40 p-3">
      {/* Part 1 — always. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => patchFilters({ search: e.target.value })}
            placeholder={t("budget.transactions.search")}
            className="w-full rounded-xl bg-surface-2 py-2 pl-8 pr-3 text-sm text-fg"
          />
        </label>
        <Select
          value={filters.accountId}
          onChange={(v) => patchFilters({ accountId: v })}
          options={[
            { value: "", label: t("budget.transactions.allAccounts") },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
          className="w-48"
        />
        {/* Select is a custom dropdown, not a native <select>, and does not
         *  forward a data-testid — this wrapper gives tests a stable hook
         *  without touching the shared component. */}
        <div data-testid="time-frame" className="w-44">
          <Select
            value={filters.timeFrame}
            onChange={(v) =>
              // Updater form, not `withTimeFrame(filters, v)` off the render
              // snapshot (finding 6/MINOR) — `patchFilters` re-reads the
              // current filters at apply time, the same discipline as every
              // other write in this file.
              patchFilters((prev) => withTimeFrame(prev, v as (typeof TIME_FRAMES)[number]))
            }
            options={TIME_FRAMES.map((f) => ({
              value: f,
              label: t(`budget.transactions.timeFrames.${f}`),
            }))}
            className="w-44"
          />
        </div>
        <button
          type="button"
          data-testid="filters-toggle"
          onClick={() => setPanelOpen((v) => !v)}
          className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ${
            panelOpen ? "bg-surface-3 text-fg" : "bg-surface-2 text-fg-dim hover:text-fg"
          }`}
        >
          <SlidersHorizontal className="size-4" />
          {t("budget.transactions.filters")}
        </button>
      </div>

      {filters.timeFrame === "custom" && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <input
            type="date"
            aria-label={t("budget.transactions.from")}
            value={filters.from}
            onChange={(e) => patchFilters({ from: e.target.value })}
            className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg"
          />
          <input
            type="date"
            aria-label={t("budget.transactions.to")}
            value={filters.to}
            onChange={(e) => patchFilters({ to: e.target.value })}
            className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg"
          />
        </div>
      )}

      {/* Part 2 — the filter panel. */}
      {panelOpen && (
        <>
          <div className="mt-3 h-px bg-surface-2" />
          <FilterPanel />
        </>
      )}

      {/* Part 3 — active filters, with the readout pinned top-right. */}
      {isFiltered(filters) && (
        <>
          <div className="mt-3 h-px bg-surface-2" />
          <div className="relative pt-3">
            <ActiveFilterChips />
            {counts && (
              <p
                data-testid="counts-readout"
                className="absolute right-0 top-3 text-xs text-fg-faint"
              >
                {t("budget.transactions.matchingOfTotal", {
                  matching: counts.matching,
                  total: counts.total,
                })}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

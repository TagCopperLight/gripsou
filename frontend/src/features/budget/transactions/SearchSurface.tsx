import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Funnel, Search } from "lucide-react";

import { useBudget } from "../budgetContext";
import { FilterPanel } from "./FilterPanel";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { Select } from "../../../ui/Select";
import { useAccounts } from "../../../api/accounts";
import { TIME_FRAMES, isFiltered, withTimeFrame } from "../../../lib/budgetFilters";
import type { TransactionCounts } from "../../../api/wire";
import { DateInput } from "../../../ui/DateInput";
import { staleClass } from "../../../ui/stale";

/** The Transactions search surface: three parts, each rendered only when it has something to show.
 *  Elevation: the surface is `surface-2` and every control on it drops back to `surface`. */
export function SearchSurface({ counts, countsStale = false, onSubmitSearch }: {
  counts?: TransactionCounts;
  /** `counts` are a previous filter's, while this one's load. */
  countsStale?: boolean;
  onSubmitSearch?: () => void;
}) {
  const { t } = useTranslation();
  const { filters, patchFilters } = useBudget();
  const [panelOpen, setPanelOpen] = useState(false);
  const accounts = useAccounts().data ?? [];

  return (
    <div className="relative rounded-xl bg-surface-2 p-3">
      {/* A phone puts the filters button beside the search, and the two selects on the line under them, half each. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1 max-md:min-w-0 max-md:basis-3/5">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => patchFilters({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSubmitSearch?.();
              }
            }}
            placeholder={t("budget.transactions.search")}
            className="w-full rounded-xl bg-surface py-2 pl-8 pr-3 text-sm text-fg placeholder:text-fg-faint outline-none"
          />
        </label>
        <Select
          value={filters.accountId}
          onChange={(v) => patchFilters({ accountId: v })}
          tone="sunken"
          options={[
            { value: "", label: t("budget.transactions.allAccounts") },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
          className="w-48 max-md:order-1 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:basis-2/5"
        />
        {/* `Select` forwards no data-testid, so this wrapper is the test hook. */}
        <div data-testid="time-frame" className="w-44 max-md:order-1 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:basis-2/5">
          <Select
            value={filters.timeFrame}
            tone="sunken"
            onChange={(v) =>
              // Updater form: `patchFilters` re-reads the current filters at apply time.
              patchFilters((prev) => withTimeFrame(prev, v as (typeof TIME_FRAMES)[number]))
            }
            options={TIME_FRAMES.map((f) => ({
              value: f,
              label: t(`budget.transactions.timeFrames.${f}`),
            }))}
            className="w-44 max-md:w-full"
          />
        </div>
        <button
          type="button"
          data-testid="filters-toggle"
          onClick={() => setPanelOpen((v) => !v)}
          className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-fg transition-colors duration-140 ${
            panelOpen ? "bg-surface-3" : "enabled:hover:bg-surface-3"
          }`}
        >
          <Funnel className="size-4" />
          {/* An icon on a phone, so the search keeps the room to show its placeholder. */}
          <span className="max-md:sr-only">{t("budget.transactions.filters")}</span>
          {panelOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {filters.timeFrame === "custom" && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <DateInput
            tone="sunken"
            aria-label={t("budget.transactions.from")}
            value={filters.from}
            onChange={(from) => patchFilters({ from, period: undefined })}
            className="max-w-40"
          />
          <DateInput
            tone="sunken"
            aria-label={t("budget.transactions.to")}
            value={filters.to}
            onChange={(to) => patchFilters({ to, period: undefined })}
            className="max-w-40"
          />
        </div>
      )}

      {panelOpen && (
        <>
          <div className="mt-3 h-px bg-surface-3" />
          <FilterPanel />
        </>
      )}

      {isFiltered(filters) && (
        <>
          <div className="mt-3 h-px bg-surface-3" />
          {/* A phone puts the count on its own line above the chips, which then get the full width. */}
          <div className="relative pt-3 max-md:flex max-md:flex-col max-md:gap-2.5">
            <ActiveFilterChips />
            {counts && (
              <p
                data-testid="counts-readout"
                className={`absolute right-0 top-3 text-xs text-fg-faint max-md:static max-md:order-first ${staleClass(countsStale)}`}
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

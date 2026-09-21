import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { useBudget } from "./budgetContext";
import { useAccounts } from "../../api/hooks";
import { useBudgetCategories, useBudgetTags } from "../../api/budget";
import { categoryLabel } from "../../lib/budget";
import {
  EMPTY_FILTERS, activeFilters, clearFilter, type ActiveFilter,
} from "../../lib/budgetFilters";

export function ActiveFilterChips() {
  const { t } = useTranslation();
  const { filters, setFilters, patchFilters } = useBudget();
  const accounts = useAccounts().data ?? [];
  const categories = useBudgetCategories().data ?? [];
  const tags = useBudgetTags().data ?? [];

  const chips = activeFilters(filters);
  if (chips.length === 0) return null;

  const label = (a: ActiveFilter): string => {
    switch (a.kind) {
      case "search":
        return `"${a.value}"`;
      case "account":
        return accounts.find((x) => x.id === a.id)?.name ?? t("budget.transactions.account");
      case "timeFrame":
        return `${filters.from || "…"} → ${filters.to || "…"}`;
      case "period":
        return `${t("budget.transactions.selectedPeriod")}: ${filters.periodLabel}`;
      case "bucket":
        return t(`budget.transactions.buckets.${a.value}`);
      case "category": {
        const c = categories.find((x) => x.id === a.id);
        return c ? categoryLabel(t, c) : t("budget.transactions.columns.category");
      }
      case "tag":
        return tags.find((x) => x.id === a.id)?.name ?? t("budget.transactions.columns.tags");
      case "uncategorized":
        return t("budget.uncategorized");
      case "needsReview":
        return t("budget.needsReview");
    }
  };

  // The id is part of the test id so a chip can be cleared by name, and so two
  // category chips do not collide.
  const testId = (a: ActiveFilter) =>
    `chip-clear-${a.kind}${"id" in a ? `-${a.id}` : ""}`;

  return (
    <div data-testid="active-filters" className="flex flex-wrap items-center gap-2 pr-40">
      {chips.map((a) => (
        <span
          key={testId(a)}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-fg-dim"
        >
          {label(a)}
          <button
            type="button"
            data-testid={testId(a)}
            aria-label={t("budget.transactions.removeFilter")}
            onClick={() => patchFilters((prev) => clearFilter(prev, a))}
            className="cursor-pointer text-fg-faint hover:text-fg"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <button
        type="button"
        data-testid="clear-all"
        onClick={() => setFilters({ ...EMPTY_FILTERS })}
        className="cursor-pointer text-xs font-medium text-fg-dim hover:text-fg"
      >
        {t("budget.transactions.clearAll")}
      </button>
    </div>
  );
}

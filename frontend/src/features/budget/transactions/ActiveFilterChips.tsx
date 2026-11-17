import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { useBudget } from "../budgetContext";
import { useAccounts } from "../../../api/accounts";
import { useBudgetCategories, useBudgetTags } from "../../../api/budget";
import { categoryLabel, safeBudgetColor } from "../../../lib/budget";
import { otherFlag, typeBucket } from "../budgetIcons";
import { periodLabel } from "../../../lib/period";
import {
  EMPTY_FILTERS, activeFilters, clearFilter, type ActiveFilter,
} from "../../../lib/budgetFilters";

export function ActiveFilterChips() {
  const { t, i18n } = useTranslation();
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
        return filters.timeFrame === "custom"
          ? `${filters.from || "…"} → ${filters.to || "…"}`
          : t(`budget.transactions.timeFrames.${filters.timeFrame}`);
      case "period":
        return `${t("budget.transactions.selectedPeriod")}: ${filters.period ? periodLabel(filters.period, i18n.language) : ""}`;
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
      case "transfers":
        return t("budget.transfers");
    }
  };

  const BucketIcon = (a: ActiveFilter) => {
    if (a.kind !== "bucket") return null;
    const { icon: Icon, tint } = typeBucket(a.value);
    return <Icon className={`size-3 shrink-0 ${tint}`} aria-hidden="true" />;
  };

  const FlagIcon = (a: ActiveFilter) => {
    if (a.kind !== "uncategorized" && a.kind !== "needsReview" && a.kind !== "transfers")
      return null;
    const { icon: Icon, tint, strokeWidth } = otherFlag(a.kind);
    return (
      <Icon className={`size-3 shrink-0 ${tint}`} strokeWidth={strokeWidth} aria-hidden="true" />
    );
  };

  const dot = (a: ActiveFilter): string | null => {
    switch (a.kind) {
      case "account":
        return accounts.find((x) => x.id === a.id)?.color ?? null;
      case "category": {
        const c = categories.find((x) => x.id === a.id);
        return c ? safeBudgetColor(c.color) : null;
      }
      case "tag": {
        const tag = tags.find((x) => x.id === a.id);
        return tag ? safeBudgetColor(tag.color) : null;
      }
      default:
        return null;
    }
  };

  const testId = (a: ActiveFilter) =>
    `chip-clear-${a.kind}${"id" in a ? `-${a.id}` : ""}`;

  return (
    <div data-testid="active-filters" className="flex flex-wrap items-center gap-2 pr-40 max-md:pr-0">
      {chips.map((a) => {
        const color = dot(a);
        return (
          <button
            key={testId(a)}
            type="button"
            data-testid={testId(a)}
            aria-label={`${t("budget.transactions.removeFilter")}: ${label(a)}`}
            onClick={() => patchFilters((prev) => clearFilter(prev, a))}
            className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-3 px-2.5 py-1 text-xs text-fg-dim transition-colors duration-140 hover:text-fg"
          >
            {BucketIcon(a)}
            {FlagIcon(a)}
            {color && (
              <span
                aria-hidden="true"
                className="size-1.75 shrink-0 rounded-full"
                style={{ background: color }}
              />
            )}
            {label(a)}
            <X className="size-3" />
          </button>
        );
      })}
      <button
        type="button"
        data-testid="clear-all"
        onClick={() => setFilters({ ...EMPTY_FILTERS })}
        className="cursor-pointer text-xs font-medium text-fg transition-opacity duration-140 hover:opacity-70"
      >
        {t("budget.transactions.clearAll")}
      </button>
    </div>
  );
}

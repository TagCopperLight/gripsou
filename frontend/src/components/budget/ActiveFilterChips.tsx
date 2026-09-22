import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { useBudget } from "./budgetContext";
import { useAccounts } from "../../api/hooks";
import { useBudgetCategories, useBudgetTags } from "../../api/budget";
import { categoryLabel, otherFlag, typeBucket } from "../../lib/budget";
import { colorForString } from "../../lib/palette";
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
        // A preset says what the user actually picked ("This month"); only the
        // custom frame has no name of its own and falls back to its dates.
        return filters.timeFrame === "custom"
          ? `${filters.from || "…"} → ${filters.to || "…"}`
          : t(`budget.transactions.timeFrames.${filters.timeFrame}`);
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
      case "transfers":
        return t("budget.transfers");
    }
  };

  /** A bucket has no colour of its own to put in a dot — it has an icon, the
   *  same one the panel draws, in the same colour. So a bucket chip leads with
   *  that instead of a swatch. */
  const BucketIcon = (a: ActiveFilter) => {
    if (a.kind !== "bucket") return null;
    const { icon: Icon, tint } = typeBucket(a.value);
    return <Icon className={`size-3 shrink-0 ${tint}`} aria-hidden="true" />;
  };

  /** Same reasoning for the two OTHERS flags: they have an icon rather than a
   *  colour, the one the panel draws, in the same amber. */
  const FlagIcon = (a: ActiveFilter) => {
    if (a.kind !== "uncategorized" && a.kind !== "needsReview" && a.kind !== "transfers")
      return null;
    const { icon: Icon, tint, strokeWidth } = otherFlag(a.kind);
    return (
      <Icon className={`size-3 shrink-0 ${tint}`} strokeWidth={strokeWidth} aria-hidden="true" />
    );
  };

  /** Accounts, categories and tags each carry a colour of their own, so their
   *  chips lead with it — the same swatch the row shows elsewhere. Every other
   *  filter kind (a search, a time frame, a bucket) has no colour and gets no
   *  dot. A tag's colour is nullable; fall back the way the rest of the app
   *  does, on a hash of the name. */
  const dot = (a: ActiveFilter): string | null => {
    switch (a.kind) {
      case "account":
        return accounts.find((x) => x.id === a.id)?.color ?? null;
      case "category":
        return categories.find((x) => x.id === a.id)?.color ?? null;
      case "tag": {
        const tag = tags.find((x) => x.id === a.id);
        return tag ? (tag.color ?? colorForString(tag.name)) : null;
      }
      default:
        return null;
    }
  };

  // The id is part of the test id so a chip can be cleared by name, and so two
  // category chips do not collide.
  const testId = (a: ActiveFilter) =>
    `chip-clear-${a.kind}${"id" in a ? `-${a.id}` : ""}`;

  return (
    <div data-testid="active-filters" className="flex flex-wrap items-center gap-2 pr-40">
      {/* The whole chip is the remove target — the cross is only the affordance
       *  that says so, which is why it carries no handler of its own. */}
      {chips.map((a) => {
        const color = dot(a);
        return (
          <button
            key={testId(a)}
            type="button"
            data-testid={testId(a)}
            aria-label={`${t("budget.transactions.removeFilter")}: ${label(a)}`}
            onClick={() => patchFilters((prev) => clearFilter(prev, a))}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 text-xs text-fg-dim transition-colors duration-140 hover:text-fg"
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

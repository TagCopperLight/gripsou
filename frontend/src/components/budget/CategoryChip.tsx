import { useTranslation } from "react-i18next";
import { Dot } from "lucide-react";

import type { BudgetCategory } from "../../api/budget";
import { BUDGET_ICONS, categoryLabel, safeBudgetColor } from "../../lib/budget";
import { withAlpha } from "../../lib/color";

type CategoryChipProps = {
  /** `null` is the "no category" state, not a missing prop. */
  category: BudgetCategory | null;
  /** An unreviewed AI guess: outline instead of fill (spec §5). */
  needsReview?: boolean;
  className?: string;
};

const AMBER = "#f0b952";

export function CategoryChip({ category, needsReview = false, className = "" }: CategoryChipProps) {
  const { t } = useTranslation();
  const label = category ? categoryLabel(t, category) : t("budget.uncategorized");
  const color = category ? safeBudgetColor(category.color) : AMBER;
  const Icon = (category?.icon && BUDGET_ICONS[category.icon]) || Dot;

  return (
    <span
      data-testid="category-chip"
      data-variant={category ? "category" : "uncategorized"}
      title={label}
      style={{
        color,
        backgroundColor: needsReview ? undefined : withAlpha(color, 0.22),
      }}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-xl px-2.25 py-1 text-xs font-medium ${
        needsReview ? "border border-dotted" : ""
      } ${className}`}
    >
      <span className="truncate">{label}</span>
      <Icon className="size-3.5 shrink-0" />
    </span>
  );
}

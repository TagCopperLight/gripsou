import { useTranslation } from "react-i18next";
import { Dot, X } from "lucide-react";

import type { BudgetCategory } from "../../api/budget";
import { BUDGET_ICONS, categoryLabel, safeBudgetColor } from "../../lib/budget";
import { tint } from "../../lib/color";

type CategoryChipProps = {
  /** `null` is the "no category" state, not a missing prop. */
  category: BudgetCategory | null;
  /** An unreviewed AI guess: outline instead of fill (spec §5). */
  needsReview?: boolean;
  /** The chip sits inside something that removes it when clicked: on hover of
   *  that `group`, the icon cross-fades into a cross so the click reads as a
   *  removal before it happens. Stacked, not appended — the chip must not
   *  change width under the cursor. */
  removable?: boolean;
  className?: string;
};

const AMBER = "#f0b952";

export function CategoryChip({
  category,
  needsReview = false,
  removable = false,
  className = "",
}: CategoryChipProps) {
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
        backgroundColor: needsReview ? undefined : tint(color, 0.22),
      }}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-xl px-2.25 py-1 text-xs font-medium ${
        needsReview ? "border border-dotted" : ""
      } ${className}`}
    >
      {removable ? (
        <span className="grid size-3.5 shrink-0 place-items-center">
          <Icon className="col-start-1 row-start-1 size-3.5 transition-opacity duration-140 group-hover:opacity-0" />
          <X
            className="col-start-1 row-start-1 size-3.5 opacity-0 transition-opacity duration-140 group-hover:opacity-100"
            aria-hidden="true"
          />
        </span>
      ) : (
        <Icon className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

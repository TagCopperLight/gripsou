import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { UNCATEGORISED_COLOR, categoryLabel, safeBudgetColor, type CategoryLike } from "../../lib/budget";
import { tint } from "../../lib/color";
import { CategoryIcon } from "./CategoryIcon";

type CategoryChipProps = {
  category: CategoryLike | null;
  needsReview?: boolean;
  /** Inside a parent that removes it on click (`group`): on hover the icon cross-fades into a cross. Stacked, so the width never changes. */
  removable?: boolean;
  /** `text` is the label alone in its colour, for a row whose avatar already shows the icon. */
  look?: "chip" | "text";
  className?: string;
};

export function CategoryChip({
  category,
  needsReview = false,
  removable = false,
  look = "chip",
  className = "",
}: CategoryChipProps) {
  const { t } = useTranslation();
  const label = category ? categoryLabel(t, category) : t("budget.uncategorized");
  const color = category ? safeBudgetColor(category.color) : UNCATEGORISED_COLOR;
  const icon = category?.icon ?? null;

  return (
    <span
      data-testid="category-chip"
      title={label}
      style={{
        color,
        backgroundColor: needsReview || look === "text" ? undefined : tint(color, 0.22),
      }}
      className={`inline-flex max-w-full items-center font-medium text-xs ${
        look === "text"
          ? needsReview ? "underline decoration-dashed underline-offset-3" : ""
          : `gap-1.5 rounded-xl px-2.25 py-1 ${needsReview ? "outline-2 outline-dashed -outline-offset-2" : ""}`
      } ${className}`}
    >
      {look === "text" ? null : removable ? (
        <span className="grid size-3.5 shrink-0 place-items-center">
          <CategoryIcon
            icon={icon}
            className="col-start-1 row-start-1 size-3.5 transition-opacity duration-140 group-hover:opacity-0"
          />
          <X
            className="col-start-1 row-start-1 size-3.5 opacity-0 transition-opacity duration-140 group-hover:opacity-100"
            aria-hidden="true"
          />
        </span>
      ) : (
        <CategoryIcon icon={icon} className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

import { Tag, X } from "lucide-react";

import type { BudgetTag } from "../../api/budget";
import { safeBudgetColor } from "../../lib/budget";
import { tint } from "../../lib/color";

type TagChipProps = {
  tag: Pick<BudgetTag, "name" | "color">;
  /** See `CategoryChip`: inside a `group` that removes the chip, the tag icon
   *  cross-fades into a cross on hover, at the same width. */
  removable?: boolean;
  className?: string;
};

export function TagChip({ tag, removable = false, className = "" }: TagChipProps) {
  const color = safeBudgetColor(tag.color);
  return (
    <span
      data-testid="tag-chip"
      title={tag.name}
      style={{ color, backgroundColor: tint(color, 0.18) }}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2.25 py-1 text-[11px] font-medium ${className}`}
    >
      {removable ? (
        <span className="grid size-3 shrink-0 place-items-center">
          <Tag className="col-start-1 row-start-1 size-3 transition-opacity duration-140 group-hover:opacity-0" />
          <X
            className="col-start-1 row-start-1 size-3 opacity-0 transition-opacity duration-140 group-hover:opacity-100"
            aria-hidden="true"
          />
        </span>
      ) : (
        <Tag className="size-3 shrink-0" />
      )}
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

import { Tag } from "lucide-react";

import type { BudgetTag } from "../../api/budget";
import { safeBudgetColor } from "../../lib/budget";
import { withAlpha } from "../../lib/color";

type TagChipProps = { tag: Pick<BudgetTag, "name" | "color">; className?: string };

export function TagChip({ tag, className = "" }: TagChipProps) {
  const color = safeBudgetColor(tag.color);
  return (
    <span
      data-testid="tag-chip"
      title={tag.name}
      style={{ color, backgroundColor: withAlpha(color, 0.18) }}
      className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.75 py-0.5 text-[11px] font-medium ${className}`}
    >
      <Tag className="size-3 shrink-0" />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

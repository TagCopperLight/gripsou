import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Tag, X } from "lucide-react";

import { useBudget } from "./budgetContext";
import { CategoryChooser } from "./CategoryChooser";
import { TagChooser } from "./TagChooser";
import { Button } from "../Button";

type SelectionBarProps = {
  /** The server's `matching` count — what "all shown" actually covers. */
  matching: number;
  showChecked: boolean;
  busy: boolean;
  onAssignCategory: (categoryId: string | null) => void;
  onAddTags: (tagIds: string[]) => void;
  onMarkChecked: () => void;
};

/** §2.4 — fixed to the bottom of the viewport, floating over the surface. */
export function SelectionBar({
  matching, showChecked, busy, onAssignCategory, onAddTags, onMarkChecked,
}: SelectionBarProps) {
  const { t } = useTranslation();
  const { selection, anySelected, clearSelection } = useBudget();
  const [open, setOpen] = useState<"categories" | "tags" | null>(null);
  const [pendingTags, setPendingTags] = useState<string[]>([]);

  if (!anySelected) return null;

  // "All shown" has no id list to count, by design — the server's `matching`
  // is the honest number, and with no filter set that is the whole ledger.
  const count = selection.mode === "allShown" ? matching : selection.ids.size;

  const closeTags = () => {
    if (pendingTags.length) onAddTags(pendingTags);
    setPendingTags([]);
    setOpen(null);
  };

  return (
    <div
      data-testid="selection-bar"
      className="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-fit items-center gap-3 rounded-2xl bg-surface-3 px-4 py-2.5 shadow-lg"
    >
      <span data-testid="selection-count" className="text-sm text-fg">
        {t("budget.transactions.rowsSelected", { count })}
      </span>
      {/* Phase 4 fills this in: a cross-currency total needs FX at the
          transaction's date, which lands with the aggregation endpoints. */}
      <span data-testid="selection-total" className="text-sm text-fg-faint">
        {t("budget.transactions.total")}: —
      </span>
      <span className="h-5 w-px bg-surface-2" />
      <Button variant="ghost" disabled={busy} onClick={() => setOpen("categories")}>
        {t("budget.transactions.assignCategory")}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={() => setOpen("tags")}>
        <Tag className="size-3.5" /> {t("budget.transactions.addTags")}
      </Button>
      {showChecked && (
        <Button variant="ghost" data-testid="bulk-checked" disabled={busy} onClick={onMarkChecked}>
          <Check className="size-3.5" /> {t("budget.transactions.markChecked")}
        </Button>
      )}
      <button
        type="button"
        data-testid="selection-clear"
        onClick={clearSelection}
        aria-label={t("budget.transactions.clearSelection")}
        className="cursor-pointer text-fg-faint hover:text-fg"
      >
        <X className="size-4" />
      </button>

      {open === "categories" && (
        <CategoryChooser
          mode="pick"
          selectedIds={[]}
          // Bulk-clearing the category on a whole selection — potentially the
          // entire ledger, with "all shown" and no filters — has no
          // legitimate one-click path (finding 5): the far smaller per-row
          // correction gets a confirmation dialog, so this one-click line
          // must not exist at all here.
          allowNone={false}
          onPick={(id) => onAssignCategory(id)}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "tags" && (
        <TagChooser
          selectedIds={pendingTags}
          onToggle={(id) =>
            setPendingTags((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            )
          }
          onClose={closeTags}
        />
      )}
    </div>
  );
}

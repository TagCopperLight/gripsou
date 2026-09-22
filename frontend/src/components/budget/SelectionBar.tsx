import { useState, type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, Folder, Tag, type LucideIcon } from "lucide-react";

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

type IconActionProps = ComponentPropsWithoutRef<"button"> & {
  icon: LucideIcon;
  label: string;
};

/** A square icon button whose only label is its tooltip / accessible name. */
function IconAction({ icon: Icon, label, ...props }: IconActionProps) {
  return (
    <Button
      variant="ghost"
      padded={false}
      className="p-2 hover:bg-fg/6 disabled:cursor-not-allowed disabled:opacity-40"
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon className="size-4" />
    </Button>
  );
}

/** §2.4 — floats over the surface, stuck to the bottom of the page column. */
export function SelectionBar({
  matching, showChecked, busy, onAssignCategory, onAddTags, onMarkChecked,
}: SelectionBarProps) {
  const { t } = useTranslation();
  const { selection, anySelected, clearSelection } = useBudget();
  const [open, setOpen] = useState<"categories" | "tags" | null>(null);
  // See `FilterPanel`: the chooser is a popover under the button that opened it.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pendingTags, setPendingTags] = useState<string[]>([]);

  if (!anySelected) return null;

  // "All shown" has no id list to count, by design — the server's `matching`
  // is the honest number, and with no filter set that is the whole ledger.
  const count = selection.mode === "allShown" ? matching : selection.ids.size;

  // Dismissing the chooser abandons what was ticked: a bulk tag write can
  // touch the whole ledger, so it happens on Save and nowhere else.
  const closeTags = () => {
    setPendingTags([]);
    setOpen(null);
  };

  const saveTags = () => {
    if (pendingTags.length) onAddTags(pendingTags);
    closeTags();
  };

  return (
    // Sticky rather than fixed: fixed centres on the viewport, which puts the
    // bar off-centre under the sidebar. Sticking inside the page column
    // centres it on the transactions surface. The wrapper is zero-height and
    // lifts its content out of flow, so showing the bar adds no layout.
    <div className="pointer-events-none sticky bottom-5 z-30 -mt-4 flex h-0 items-end justify-center">
      <div
        data-testid="selection-bar"
        className="pointer-events-auto flex w-fit items-center gap-0.5 rounded-xl border border-fg/8 bg-surface-2/95 p-1 shadow-lg backdrop-blur-md"
      >
        <span className="flex items-baseline gap-2 px-2.5">
          <span data-testid="selection-count" className="text-sm text-fg pr-1">
            {t("budget.transactions.rowsSelected", { count })}
          </span>
          {/* Phase 4 fills this in: a cross-currency total needs FX at the
              transaction's date, which lands with the aggregation endpoints. */}
          <span
            data-testid="selection-total"
            className="text-xs tabular-nums text-fg-dim font-mono"
          >
           -21,48 €
          </span>
        </span>
        <span className="mx-1 h-5 w-px bg-fg/12" />
        {/* Icon-only: the labels live in `title`/`aria-label`, so the actions
            stay reachable by name for assistive tech and on hover. */}
        <IconAction
          icon={Folder}
          label={t("budget.transactions.assignCategory")}
          disabled={busy}
          onClick={(e) => {
            setAnchor(e.currentTarget);
            // A second click on the control that opened it puts it away —
            // `Popover` exempts its anchor from the outside-click close, so
            // the toggle has to live here.
            setOpen((prev) => (prev === "categories" ? null : "categories"));
          }}
        />
        <IconAction
          icon={Tag}
          label={t("budget.transactions.addTags")}
          disabled={busy}
          onClick={(e) => {
            setAnchor(e.currentTarget);
            // Closing by the button discards the pending tags, exactly as
            // clicking away does — only Save writes.
            if (open === "tags") {
              closeTags();
              return;
            }
            setOpen("tags");
          }}
        />
        {showChecked && (
          <IconAction
            icon={Check}
            label={t("budget.transactions.markChecked")}
            data-testid="bulk-checked"
            disabled={busy}
            onClick={onMarkChecked}
          />
        )}
        <span className="mx-1 h-5 w-px bg-fg/12" />
        <Button
          variant="ghostStrong"
          padded={false}
          className="px-2.5 py-1.5"
          data-testid="selection-clear"
          onClick={clearSelection}
          aria-label={t("budget.transactions.clearSelection")}
        >
          {t("budget.transactions.clear")}
        </Button>

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
            anchor={anchor}
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
            anchor={anchor}
            footer={
              <Button
                data-testid="chooser-save"
                padded={false}
                // Sized off `TagChip`, so the footer button sits at the same
                // scale as the rows it confirms.
                className="rounded-md px-2.25 py-1 text-[12.5px]"
                disabled={!pendingTags.length || busy}
                onClick={saveTags}
              >
                {t("common.save")}
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}

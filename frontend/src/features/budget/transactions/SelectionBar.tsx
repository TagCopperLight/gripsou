import { useState, type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";
import { Check, Folder, Tag, type LucideIcon } from "lucide-react";

import { useBudget } from "../budgetContext";
import { CategoryChooser } from "../CategoryChooser";
import { TagChooser } from "../TagChooser";
import { Button } from "../../../ui/Button";
import { MaskedMoney } from "../../../ui/MaskedMoney";
import { FxAsterisk } from "../../../ui/FxNote";
import { usePopover } from "../../../ui/usePopover";

type SelectionBarProps = {
  /** The server's `selectable` count: the cash rows shown, never a buy or sale. */
  matching: number;
  /** In the reporting currency. "All shown" is the server's `matchingTotal`; an id selection is summed from loaded rows. */
  total: string;
  /** Some selected row has no exchange rate, so `total` leaves it out. */
  fxMissing?: boolean;
  showChecked: boolean;
  masked?: boolean;
  busy: boolean;
  onAssignCategory: (categoryId: string | null) => void;
  onAddTags: (tagIds: string[]) => void;
  onMarkChecked: () => void;
};

type IconActionProps = ComponentPropsWithoutRef<"button"> & {
  icon: LucideIcon;
  label: string;
};

function IconAction({ icon: Icon, label, ...props }: IconActionProps) {
  return (
    <Button
      variant="ghost"
      padded={false}
      className="p-2 hover:bg-fg/6"
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon className="size-4" />
    </Button>
  );
}

export function SelectionBar({
  matching, total, fxMissing = false, showChecked, masked = false, busy, onAssignCategory, onAddTags, onMarkChecked,
}: SelectionBarProps) {
  const { t } = useTranslation();
  const { selection, anySelected, clearSelection } = useBudget();
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  // Closing the tag chooser abandons what was ticked: a bulk tag write can touch the whole ledger, so only Save writes.
  const chooser = usePopover<"categories" | "tags">(() => setPendingTags([]));

  if (!anySelected) return null;

  // "All shown" has no id list: the server's `matching` count is the number.
  const count = selection.mode === "allShown" ? matching : selection.ids.size;

  const saveTags = () => {
    if (pendingTags.length) onAddTags(pendingTags);
    chooser.close();
  };

  return (
    // Sticky, not fixed: fixed centres on the viewport, which is off-centre under the sidebar.
    <div className="pointer-events-none sticky bottom-5 z-30 -mt-4 flex h-0 items-end justify-center">
      <div
        data-testid="selection-bar"
        className="pointer-events-auto flex w-fit items-center gap-0.5 rounded-xl border border-fg/8 bg-surface-2/95 p-1 shadow-lg backdrop-blur-md"
      >
        <span className="flex items-baseline gap-2 px-2.5">
          <span data-testid="selection-count" className="text-sm text-fg pr-1">
            {t("budget.transactions.rowsSelected", { count })}
          </span>
          <span
            data-testid="selection-total"
            className={`relative text-xs text-fg-dim ${fxMissing ? "mr-1.5" : ""}`}
            title={fxMissing ? t("fx.budget") : undefined}
          >
            <MaskedMoney masked={masked} value={total} signed className="text-xs" />
            {fxMissing && <FxAsterisk />}
          </span>
        </span>
        <span className="mx-1 h-5 w-px bg-fg/12" />
        <IconAction
          icon={Folder}
          label={t("budget.transactions.assignCategory")}
          disabled={busy}
          aria-haspopup="dialog"
          aria-expanded={chooser.key === "categories"}
          onClick={(e) => chooser.toggle("categories", e.currentTarget)}
        />
        <IconAction
          icon={Tag}
          label={t("budget.transactions.addTags")}
          disabled={busy}
          aria-haspopup="dialog"
          aria-expanded={chooser.key === "tags"}
          onClick={(e) => chooser.toggle("tags", e.currentTarget)}
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

        {chooser.key === "categories" && (
          <CategoryChooser
            mode="pick"
            selectedIds={[]}
            // Deliberately no bulk clear: on "all shown" it could wipe the whole ledger in one click.
            allowNone={false}
            onPick={(id) => onAssignCategory(id)}
            onClose={chooser.close}
            anchor={chooser.anchor}
          />
        )}
        {chooser.key === "tags" && (
          <TagChooser
            selectedIds={pendingTags}
            onToggle={(id) =>
              setPendingTags((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
              )
            }
            onClose={chooser.close}
            anchor={chooser.anchor}
            footer={
              <Button
                data-testid="chooser-save"
                padded={false}
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

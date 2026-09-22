import { useTranslation } from "react-i18next";

import { EntityChooser } from "./EntityChooser";
import { CategoryChip } from "./CategoryChip";
import { useBudgetCategories } from "../../api/budget";
import { BUDGET_KINDS, categoryLabel, type ChooserItem } from "../../lib/budget";

type CategoryChooserProps = {
  mode: "multi" | "pick";
  selectedIds: string[];
  onToggle?: (id: string) => void;
  onPick?: (id: string | null) => void;
  onClose: () => void;
  /** `pick` mode only: whether the "no category" line is offered at all.
   *  Defaults to `true` — today's behaviour for the row-assignment path,
   *  which has a legitimate one-click "clear this row" use. The bulk path
   *  (`SelectionBar`) passes `false`: with "all shown" and no filters, that
   *  same line would clear the category on the entire ledger with one click
   *  and no confirmation (finding 5) — suppressing it outright is the only
   *  option with no legitimate quick path. */
  allowNone?: boolean;
  /** The control that opened it — the chooser hangs under it. */
  anchor?: HTMLElement | null;
};

/** The same chooser serves four call sites (§5): filtering, assigning on a
 *  row, and both again from the selection bar. Archived categories never
 *  appear — they are kept for history, not for picking. */
export function CategoryChooser({
  mode, selectedIds, onToggle, onPick, onClose, allowNone = true, anchor,
}: CategoryChooserProps) {
  const { t } = useTranslation();
  const categories = (useBudgetCategories().data ?? []).filter((c) => !c.archived);

  const items: ChooserItem[] = BUDGET_KINDS.flatMap((kind) =>
    categories
      .filter((c) => c.kind === kind)
      .map((c) => ({
        id: c.id,
        label: categoryLabel(t, c),
        group: kind,
        render: <CategoryChip category={c} />,
      })),
  );

  return (
    <EntityChooser
      title={t("budget.chooser.categoryTitle")}
      items={items}
      groups={BUDGET_KINDS.map((k) => ({ key: k, label: t(`budget.kinds.${k}`).toUpperCase() }))}
      mode={mode}
      selectedIds={selectedIds}
      onToggle={onToggle}
      onPick={onPick}
      onClose={onClose}
      anchor={anchor}
      noneLabel={allowNone ? t("budget.chooser.noCategory") : undefined}
    />
  );
}

import { useTranslation } from "react-i18next";

import { EntityChooser } from "./EntityChooser";
import { CategoryChip } from "./CategoryChip";
import { useBudgetCategories } from "../../api/budget";
import { BUDGET_KINDS, categoryLabel, type ChooserItem } from "../../lib/budget";

type CategoryChooserProps = {
  selectedIds: string[];
  onClose: () => void;
  /** The control that opened it — the chooser hangs under it. */
  anchor?: HTMLElement | null;
} & (
  | { mode: "multi"; onToggle: (id: string) => void }
  | {
      mode: "pick";
      onPick: (id: string | null) => void;
      /** Whether the "no category" line is offered at all. Defaults to `true`
       *  — the row-assignment path has a legitimate one-click "clear this row"
       *  use. The bulk path passes `false`: with "all shown" and no filters,
       *  that same line would clear the category on the entire ledger with
       *  one click and no confirmation. */
      allowNone?: boolean;
    }
);

/** The same chooser serves every call site: filtering, assigning on a row,
 *  and both again from the selection bar. Archived categories never appear —
 *  they are kept for history, not for picking. */
export function CategoryChooser(props: CategoryChooserProps) {
  const { selectedIds, onClose, anchor } = props;
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

  const common = {
    title: t("budget.chooser.categoryTitle"),
    items,
    groups: BUDGET_KINDS.map((k) => ({ key: k, label: t(`budget.kinds.${k}`).toUpperCase() })),
    selectedIds,
    onClose,
    anchor,
  };

  return props.mode === "pick" ? (
    <EntityChooser
      {...common}
      mode="pick"
      onPick={props.onPick}
      noneLabel={props.allowNone === false ? undefined : t("budget.chooser.noCategory")}
    />
  ) : (
    <EntityChooser {...common} mode="multi" onToggle={props.onToggle} />
  );
}

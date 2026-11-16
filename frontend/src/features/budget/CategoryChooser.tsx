import { useTranslation } from "react-i18next";

import { EntityChooser, type ChooserItem } from "./EntityChooser";
import { CategoryChip } from "./CategoryChip";
import { useBudgetCategories } from "../../api/budget";
import { BUDGET_KINDS, categoryLabel } from "../../lib/budget";

type CategoryChooserProps = {
  selectedIds: string[];
  onClose: () => void;
  anchor?: HTMLElement | null;
} & (
  | { mode: "multi"; onToggle: (id: string) => void }
  | {
      mode: "pick";
      onPick: (id: string | null) => void;
      /** Defaults to true. The bulk path passes false: with "all shown" and no filters that line would clear every category in one click. */
      allowNone?: boolean;
    }
);

/** Archived categories never appear. */
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

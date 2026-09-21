import { useTranslation } from "react-i18next";

import { EntityChooser } from "./EntityChooser";
import { TagChip } from "./TagChip";
import { useBudgetTags } from "../../api/budget";
import type { ChooserItem } from "../../lib/budget";

type TagChooserProps = {
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
};

/** Flat, and always multi-select: several tags on a row, and several in a
 *  filter (where they are AND'd server-side). */
export function TagChooser({ selectedIds, onToggle, onClose }: TagChooserProps) {
  const { t } = useTranslation();
  const tags = useBudgetTags().data ?? [];

  const items: ChooserItem[] = tags.map((tag) => ({
    id: tag.id,
    label: tag.name,
    render: <TagChip tag={tag} />,
  }));

  return (
    <EntityChooser
      title={t("budget.chooser.tagTitle")}
      items={items}
      mode="multi"
      selectedIds={selectedIds}
      onToggle={onToggle}
      onClose={onClose}
    />
  );
}

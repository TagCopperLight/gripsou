import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EntityChooser, type ChooserItem } from "./EntityChooser";
import { TagChip } from "./TagChip";
import { useBudgetTags } from "../../api/budget";

type TagChooserProps = {
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
  anchor?: HTMLElement | null;
  footer?: ReactNode;
};

/** Always multi-select; several tags in a filter are AND'd server-side. */
export function TagChooser({ selectedIds, onToggle, onClose, anchor, footer }: TagChooserProps) {
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
      anchor={anchor}
      footer={footer}
    />
  );
}

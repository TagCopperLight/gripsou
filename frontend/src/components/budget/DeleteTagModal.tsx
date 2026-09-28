import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../ConfirmDialog";
import { useDeleteBudgetTag, type BudgetTag } from "../../api/budget";

type DeleteTagModalProps = {
  tag: BudgetTag;
  onClose: () => void;
};

export function DeleteTagModal({ tag, onClose }: DeleteTagModalProps) {
  const { t } = useTranslation();
  const remove = useDeleteBudgetTag();

  return (
    <ConfirmDialog
      title={t("settings.budget.tags.deleteTitle")}
      body={t("settings.budget.tags.deleteBody", { name: tag.name, count: tag.txCount })}
      confirmLabel={t("settings.budget.tags.deleteConfirm")}
      busy={remove.isPending}
      error={remove.isError ? t("settings.budget.tags.deleteError") : null}
      onConfirm={() => remove.mutate(tag.id, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

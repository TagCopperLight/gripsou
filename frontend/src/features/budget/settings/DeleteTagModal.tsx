import { useTranslation } from "react-i18next";
import { useErrorToast } from "../../../lib/errorToasts";

import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { useDeleteBudgetTag } from "../../../api/budget";
import type { BudgetTag } from "../../../api/wire";

type DeleteTagModalProps = {
  tag: BudgetTag;
  onClose: () => void;
};

export function DeleteTagModal({ tag, onClose }: DeleteTagModalProps) {
  const { t } = useTranslation();
  const remove = useDeleteBudgetTag();

  useErrorToast(remove.isError && t("settings.budget.tags.deleteError"));

  return (
    <ConfirmDialog
      title={t("settings.budget.tags.deleteTitle")}
      body={t("settings.budget.tags.deleteBody", { name: tag.name, count: tag.txCount })}
      confirmLabel={t("settings.budget.tags.deleteConfirm")}
      busy={remove.isPending}
      onConfirm={() => remove.mutate(tag.id, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

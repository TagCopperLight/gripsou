import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../ConfirmDialog";
import { useDeleteBudgetCategory, type BudgetCategory } from "../../api/budget";
import { categoryLabel } from "../../lib/budget";

type DeleteCategoryModalProps = {
  category: BudgetCategory;
  onClose: () => void;
};

export function DeleteCategoryModal({ category, onClose }: DeleteCategoryModalProps) {
  const { t } = useTranslation();
  const remove = useDeleteBudgetCategory();

  return (
    <ConfirmDialog
      title={t("settings.budget.categories.deleteTitle")}
      body={t("settings.budget.categories.deleteBody", {
        name: categoryLabel(t, category),
        count: category.txCount,
      })}
      confirmLabel={t("settings.budget.categories.deleteConfirm")}
      busy={remove.isPending}
      error={remove.isError ? t("settings.budget.categories.deleteError") : null}
      onConfirm={() => remove.mutate(category.id, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

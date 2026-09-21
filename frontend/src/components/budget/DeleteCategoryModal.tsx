import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { BudgetDialog } from "./BudgetDialog";
import { Button } from "../Button";
import { useDeleteBudgetCategory, type BudgetCategory } from "../../api/budget";
import { categoryLabel } from "../../lib/budget";

type DeleteCategoryModalProps = {
  category: BudgetCategory;
  onClose: () => void;
};

export function DeleteCategoryModal({ category, onClose }: DeleteCategoryModalProps) {
  const { t } = useTranslation();
  const remove = useDeleteBudgetCategory();

  const confirm = () => {
    if (remove.isPending) return;
    remove.mutate(category.id, { onSuccess: onClose });
  };

  return (
    <BudgetDialog
      busy={remove.isPending}
      title={t("settings.budget.categories.deleteTitle")}
      onClose={onClose}
      icon={<TriangleAlert className="size-5 text-red" />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={remove.isPending}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm} disabled={remove.isPending}>
            {t("settings.budget.categories.deleteConfirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg text-sm">
          {t("settings.budget.categories.deleteBody", {
            name: categoryLabel(t, category),
            count: category.txCount,
          })}
        </p>
        {remove.isError && (
          <p role="alert" className="text-red text-sm">
            {t("settings.budget.categories.deleteError")}
          </p>
        )}
      </div>
    </BudgetDialog>
  );
}

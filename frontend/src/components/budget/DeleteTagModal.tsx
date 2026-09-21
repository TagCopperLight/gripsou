import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { BudgetDialog } from "./BudgetDialog";
import { Button } from "../Button";
import { useDeleteBudgetTag, type BudgetTag } from "../../api/budget";

type DeleteTagModalProps = {
  tag: BudgetTag;
  onClose: () => void;
};

export function DeleteTagModal({ tag, onClose }: DeleteTagModalProps) {
  const { t } = useTranslation();
  const remove = useDeleteBudgetTag();

  const confirm = () => {
    if (remove.isPending) return;
    remove.mutate(tag.id, { onSuccess: onClose });
  };

  return (
    <BudgetDialog
      busy={remove.isPending}
      title={t("settings.budget.tags.deleteTitle")}
      onClose={onClose}
      icon={<TriangleAlert className="size-5 text-red" />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={remove.isPending}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm} disabled={remove.isPending}>
            {t("settings.budget.tags.deleteConfirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg text-sm">
          {t("settings.budget.tags.deleteBody", { name: tag.name, count: tag.txCount })}
        </p>
        {remove.isError && (
          <p role="alert" className="text-red text-sm">
            {t("settings.budget.tags.deleteError")}
          </p>
        )}
      </div>
    </BudgetDialog>
  );
}

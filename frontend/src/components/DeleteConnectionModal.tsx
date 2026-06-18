import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, TriangleAlert } from "lucide-react";
import { Button } from "./Button";
import { useDeleteConnection } from "../api/hooks";
import type { SyncConnection } from "../api/types";

type DeleteConnectionModalProps = {
  connection: SyncConnection;
  onClose: () => void;
  onDeleted: () => void;
};

export function DeleteConnectionModal({
  connection,
  onClose,
  onDeleted,
}: DeleteConnectionModalProps) {
  const { t } = useTranslation();
  const remove = useDeleteConnection();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const confirm = () => {
    remove.mutate(connection.id, { onSuccess: onDeleted });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.deleteConnectionTitle")}
        onClick={(e) => e.stopPropagation()}
        className="relative w-120 max-w-[90vw] bg-surface rounded-3xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="flex items-center gap-2.5 text-xl font-semibold text-fg">
            <TriangleAlert className="size-5 text-red" />
            {t("settings.deleteConnectionTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="px-6 py-4">
          <p className="text-sm text-fg-dim">{t("settings.deleteConnectionBody")}</p>
          {remove.isError && (
            <p className="mt-3 text-sm text-red">{t("settings.deleteConnectionError")}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={confirm}
            disabled={remove.isPending}
            aria-label={t("settings.deleteConnection")}
          >
            {remove.isPending
              ? t("common.loading")
              : t("settings.deleteConnection")}
          </Button>
        </div>
      </div>
    </div>
  );
}

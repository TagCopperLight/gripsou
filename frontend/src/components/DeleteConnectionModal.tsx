import { useTranslation } from "react-i18next";
import { useErrorToast } from "../lib/errorToasts";
import { ConfirmDialog } from "./ConfirmDialog";
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

  useErrorToast(remove.isError && t("settings.connections.deleteConnectionError"));

  return (
    <ConfirmDialog
      title={t("settings.connections.deleteConnectionTitle")}
      body={t("settings.connections.deleteConnectionBody")}
      confirmLabel={remove.isPending ? t("common.loading") : t("settings.connections.deleteConnection")}
      busy={remove.isPending}
      onConfirm={() => remove.mutate(connection.id, { onSuccess: onDeleted })}
      onClose={onClose}
    />
  );
}

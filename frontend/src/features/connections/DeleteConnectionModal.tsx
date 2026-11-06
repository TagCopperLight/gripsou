import { useTranslation } from "react-i18next";
import { useErrorToast } from "../../lib/errorToasts";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { useDeleteConnection } from "../../api/connections";
import type { SyncConnection } from "../../api/wire";

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
      title={t("settings.connections.deleteConnectionTitle", { name: connection.displayName })}
      body={t("settings.connections.deleteConnectionBody")}
      confirmLabel={remove.isPending ? t("settings.connections.deletingConnection") : t("settings.connections.deleteConnection")}
      busy={remove.isPending}
      onConfirm={() => remove.mutate(connection.id, { onSuccess: onDeleted })}
      onClose={onClose}
    />
  );
}

import { useTranslation } from "react-i18next";

import { useConnections, useSyncAll } from "../api/hooks";
import { flattenConnections } from "../api/types";
import { useErrorToast } from "../lib/errorToasts";
import { Button } from "./Button";
import { CardState } from "./CardState";
import { ConnectionRow } from "./ConnectionRow";
import { Dialog } from "./Dialog";

type SyncModalProps = { onClose: () => void };

// One list of connections, whatever provider each comes from; the body scrolls
// while the header and the "Sync all" footer stay visible.
export function SyncModal({ onClose }: SyncModalProps) {
  const { t } = useTranslation();
  const { data, isError, refetch } = useConnections();
  const syncAll = useSyncAll();
  useErrorToast(syncAll.isError && t("sync.startFailed"));

  const connections = flattenConnections(data);
  const isEmpty = data !== undefined && connections.length === 0;

  return (
    <Dialog
      title={t("sync.title")}
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            variant="primary"
            onClick={() => syncAll.mutate()}
            disabled={data === undefined || isEmpty || syncAll.isPending}
          >
            {t("sync.syncAll")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {data === undefined && (
          <CardState variant={isError ? "error" : "loading"} onRetry={() => void refetch()} className="h-40" />
        )}
        {isEmpty && <p className="text-fg-faint text-sm">{t("sync.empty")}</p>}
        {connections.map((c) => (
          <ConnectionRow key={c.id} conn={c} />
        ))}
      </div>
    </Dialog>
  );
}

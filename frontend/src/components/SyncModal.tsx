import { useTranslation } from "react-i18next";

import { useConnections, useSyncAll } from "../api/hooks";
import { flattenConnections } from "../api/types";
import { Button } from "./Button";
import { ConnectionRow } from "./ConnectionRow";
import { Dialog } from "./Dialog";

type SyncModalProps = { onClose: () => void };

// One list of connections, whatever provider each comes from; the body scrolls
// while the header and the "Sync all" footer stay visible.
export function SyncModal({ onClose }: SyncModalProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useConnections();
  const syncAll = useSyncAll();

  const connections = flattenConnections(data);
  const isEmpty = !isLoading && connections.length === 0;

  return (
    <Dialog
      title={t("sync.title")}
      large
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            variant="primary"
            onClick={() => syncAll.mutate()}
            disabled={isEmpty || syncAll.isPending}
          >
            {t("sync.syncAll")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {isEmpty && <p className="text-fg-faint text-sm">{t("sync.empty")}</p>}
        {connections.map((c) => (
          <ConnectionRow key={c.id} conn={c} />
        ))}
      </div>
    </Dialog>
  );
}

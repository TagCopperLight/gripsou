import { useTranslation } from "react-i18next";

import { useConnections, useSyncAll } from "../api/hooks";
import { flattenConnections } from "../api/types";
import { Button } from "./Button";
import { ConnectionRow } from "./ConnectionRow";
import { Dialog } from "./Dialog";

type SyncModalProps = { onClose: () => void };

// Provider → connection → account tree; the body scrolls while the header and
// the "Sync all" footer stay visible.
export function SyncModal({ onClose }: SyncModalProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useConnections();
  const syncAll = useSyncAll();

  const groups = data ?? [];
  const connCount = flattenConnections(groups).length;
  const isEmpty = !isLoading && connCount === 0;

  return (
    <Dialog
      title={t("sync.title")}
      subtitle={
        !isLoading && (
          <>
            {t("settings.connections.connectionsCount", { count: connCount })}
            <span className="mx-1.5">·</span>
            {t("settings.connections.providersCount", { count: groups.length })}
          </>
        )
      }
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
      <div className="flex flex-col gap-5">
        {isEmpty && <p className="text-fg-faint text-sm">{t("sync.empty")}</p>}
        {groups.map((g) => (
          <div key={g.providerKey} className="flex flex-col gap-2.5">
            <span className="text-fg-faint text-xs uppercase tracking-wide">
              {g.providerName}
            </span>
            {g.connections.map((c) => (
              <ConnectionRow
                key={c.id}
                conn={{ ...c, providerName: g.providerName }}
                showProvider={false}
              />
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

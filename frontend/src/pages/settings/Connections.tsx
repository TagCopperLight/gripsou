import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plug, RefreshCw } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { CardState } from "../../components/CardState";
import { AddConnectionModal } from "../../components/AddConnectionModal";
import { DeleteConnectionModal } from "../../components/DeleteConnectionModal";
import { useConnections } from "../../api/hooks";
import { formatRelative } from "../../lib/date";
import type { SyncConnection } from "../../api/types";

export function SettingsConnections() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useConnections();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SyncConnection | null>(null);

  const groups = data ?? [];
  const isEmpty = !isLoading && !isError && groups.length === 0;

  return (
    <div className="flex flex-col gap-4 pb-8 mt-13">
      <Surface className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-fg">
            {t("settings.connections")}
          </h2>
          {!isEmpty && (
            <Button onClick={() => setAddOpen(true)}>
              {t("settings.addConnection")}
            </Button>
          )}
        </div>

        {isLoading && <CardState variant="loading" className="h-40" />}
        {isError && (
          <CardState variant="error" onRetry={() => refetch()} className="h-40" />
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-4 py-10 text-fg-faint">
            <Plug className="size-8 opacity-40" />
            <p className="text-sm">{t("settings.noConnections")}</p>
            <Button onClick={() => setAddOpen(true)}>
              {t("settings.addConnection")}
            </Button>
          </div>
        )}

        {!isLoading && !isError && !isEmpty && (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <div key={g.providerKey} className="flex flex-col gap-3">
                <span className="text-xs uppercase tracking-wide text-fg-faint">
                  {g.providerName}
                </span>
                {g.connections.map((c) => (
                  <ConnectionCard
                    key={c.id}
                    conn={c}
                    onDelete={() => setDeleteTarget(c)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </Surface>

      {addOpen && <AddConnectionModal onClose={() => setAddOpen(false)} />}
      {deleteTarget && (
        <DeleteConnectionModal
          connection={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function ConnectionCard({
  conn,
  onDelete,
}: {
  conn: SyncConnection;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isSyncing = conn.status === "syncing";
  const isError = conn.status === "error";
  const isPending = conn.status === "pending";

  const statusText = isPending
    ? t("settings.connectionStatus.pending")
    : isSyncing
      ? t("settings.connectionStatus.syncing")
      : isError
        ? (conn.lastError ?? t("settings.connectionStatus.error"))
        : formatRelative(conn.lastSyncAt);

  return (
    <div className="bg-surface-2 rounded-2xl px-4 py-3.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg font-semibold text-[15px] truncate">
            {conn.displayName}
          </p>
          <p
            className={`text-xs flex items-center gap-1.5 ${isError ? "text-red" : isSyncing || isPending ? "text-fg-dim" : "text-fg-faint"}`}
          >
            {isSyncing && <RefreshCw className="size-3 animate-spin" />}
            {!isError && !isSyncing && !isPending && conn.status === "ok" && (
              <span className="size-2 rounded-full bg-green inline-block" />
            )}
            {statusText}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={onDelete}
          className="shrink-0 text-red hover:text-red"
          aria-label={t("settings.deleteConnection")}
        >
          {t("settings.deleteConnection")}
        </Button>
      </div>
      {conn.accounts.length > 0 && (
        <ul className="flex flex-col divide-y divide-surface">
          {conn.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-1.5">
              <span className="text-fg-dim text-sm truncate">{a.name}</span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-fg-faint text-xs">{a.typeLabel}</span>
                <span className="text-fg text-sm font-medium">{a.value}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

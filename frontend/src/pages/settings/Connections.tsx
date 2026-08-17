import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { CardState } from "../../components/CardState";
import { ConnectionRow } from "../../components/ConnectionRow";
import { AddConnectionModal } from "../../components/AddConnectionModal";
import { DeleteConnectionModal } from "../../components/DeleteConnectionModal";
import { useConnections } from "../../api/hooks";
import type { SyncConnection } from "../../api/types";

export function SettingsConnections() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useConnections();
  const groups = data ?? [];
  const conns = groups.flatMap((g) =>
    g.connections.map((c) => ({ ...c, providerName: g.providerName })),
  );
  const connCount = conns.length;
  const acctCount = conns.reduce((n, c) => n + c.accounts.length, 0);

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SyncConnection | null>(null);

  return (
    <div className="pb-8 md:mt-13">
      <Surface className="w-full">
        <div className="flex flex-col p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-fg font-semibold text-sm">
              {t("settings.connections.title")}
              {!isLoading && (
                <span className="text-fg-faint font-normal ml-2">
                  <span className="mr-2">·</span>
                  <span>{t("settings.connections.connectionsCount", { count: connCount })}</span>
                  <span className="mx-2">·</span>
                  <span>{t("settings.connections.accountsCount", { count: acctCount })}</span>
                </span>
              )}
            </h2>
            <Button onClick={() => setAddOpen(true)} padded={false} className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-xs px-2.75 py-1.5 md:w-auto">
              <Plus className="size-4" />
              {t("settings.connections.addConnection")}
            </Button>
          </div>

          {isLoading ? (
            <CardState variant="loading" className="mt-4 h-64" />
          ) : isError ? (
            <CardState
              variant="error"
              onRetry={() => refetch()}
              className="mt-4 h-64"
            />
          ) : connCount === 0 ? (
            <p className="text-sm text-fg-faint py-10 text-center">
              {t("sync.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5 mt-4">
              {conns.map((c) => (
                <ConnectionRow
                  key={c.id}
                  conn={c}
                  onDelete={() => setDeleteTarget(c)}
                />
              ))}
            </div>
          )}
        </div>
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

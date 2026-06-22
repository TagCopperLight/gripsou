import { useState } from "react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, RefreshCw, Trash2, ChevronRight, ChevronDown } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { CardState } from "../../components/CardState";
import { HoldingBadge } from "../../components/HoldingBadge";
import { AddConnectionModal } from "../../components/AddConnectionModal";
import { DeleteConnectionModal } from "../../components/DeleteConnectionModal";
import { useConnections, useSyncConnection } from "../../api/hooks";
import { formatRelative } from "../../lib/date";
import { formatMoney } from "../../lib/money";
import { colorForString } from "../../lib/palette";
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
    <div className="pb-8 mt-13">
      <Surface className="w-full">
        <div className="flex flex-col p-5">
          <div className="flex items-center justify-between">
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
            <Button onClick={() => setAddOpen(true)} padded={false} className="inline-flex items-center gap-1.5 text-xs px-2.75 py-1.5">
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

function ConnectionRow({
  conn,
  onDelete,
}: {
  conn: SyncConnection & { providerName: string };
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sync = useSyncConnection();

  const isAwaiting = conn.status === "awaiting";
  const isSyncing = conn.status === "syncing" || isAwaiting;
  const isError = conn.status === "error";
  const isPending = conn.status === "pending";

  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className="bg-surface-2 rounded-2xl overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-surface-3 transition-colors duration-140"
      >
        <HoldingBadge
          logo={conn.logo}
          ticker={conn.displayName}
          color={conn.accounts[0]?.color}
          className="size-9 rounded-lg text-[13px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-fg font-semibold text-[15px] truncate">
              {conn.displayName}
            </span>
            <StatusTag conn={conn} />
          </div>
          <p className="text-xs text-fg-faint mt-0.5">
            {conn.providerName}
            <span className="mx-1.5">·</span>
            {t("settings.connections.accountsCount", { count: conn.accounts.length })}
            <span className="mx-1.5">·</span>
            {formatRelative(conn.lastSyncAt)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <IconButton
            onClick={stop(() => sync.mutate(conn.id))}
            aria-label={t("settings.connections.syncConnection")}
            disabled={isSyncing}
          >
            <RefreshCw className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
          </IconButton>
          <IconButton
            onClick={stop(onDelete)}
            aria-label={t("settings.connections.deleteConnection")}
            danger
          >
            <Trash2 className="size-4" />
          </IconButton>
          {open ? (
            <ChevronDown className="size-4 text-fg-faint" />
          ) : (
            <ChevronRight className="size-4 text-fg-faint" />
          )}
        </div>
      </div>

      {open && conn.accounts.length > 0 && (
        <div className="px-4 pb-3">
          <div className="border-l border-surface-3 pl-4 ml-3.5">
            <ul className="flex flex-col divide-y divide-surface">
              {conn.accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="size-2.5 rounded-sm shrink-0"
                      style={{ background: a.color ?? colorForString(a.name) }}
                    />
                    <span className="text-sm text-fg-dim truncate">{a.name}</span>
                    <span className="text-[11px] rounded-md px-2 py-0.5 bg-surface-3 text-fg-faint shrink-0">
                      {a.typeLabel}
                    </span>
                  </div>
                  <span className="text-sm text-fg font-mono shrink-0">
                    {formatMoney(a.value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );

  function StatusTag({ conn }: { conn: SyncConnection }) {
    const base = "text-[11px] rounded-md px-2 py-0.5 inline-flex items-center gap-1 shrink-0";
    if (isError) {
      return (
        <span className={`${base} bg-red/15 text-red`} title={conn.lastError ?? ""}>
          {conn.lastError ?? t("settings.connections.status.error")}
        </span>
      );
    }
    if (isSyncing) {
      return (
        <span className={`${base} bg-surface-3 text-fg-dim`}>
          <RefreshCw className="size-3 animate-spin" />
          {t(isAwaiting ? "settings.connections.status.awaiting" : "settings.connections.status.syncing")}
        </span>
      );
    }
    if (isPending) {
      return (
        <span className={`${base} bg-surface-3 text-fg-dim`}>
          {t("settings.connections.status.pending")}
        </span>
      );
    }
    return (
      <span className={`${base} bg-green-soft text-green`}>
        {t("settings.connections.connectionConnected")}
      </span>
    );
  }
}

function IconButton({
  danger = false,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={`size-8 rounded-lg flex items-center justify-center cursor-pointer text-fg-faint transition-colors duration-140 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? "hover:text-red" : "hover:text-fg"
      } ${className}`}
      {...props}
    />
  );
}

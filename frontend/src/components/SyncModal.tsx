import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, X } from "lucide-react";

import { useConnections, useSyncAll, useSyncConnection } from "../api/hooks";
import { flattenConnections } from "../api/types";
import type { SyncConnection } from "../api/types";
import { Button } from "./Button";

type SyncModalProps = { onClose: () => void };

// Provider → connection → account tree. Capped at 80vh as a flex column so the
// body scrolls while the header and the "Sync all" footer stay visible.
export function SyncModal({ onClose }: SyncModalProps) {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useConnections();
  const syncOne = useSyncConnection();
  const syncAll = useSyncAll();

  // Close on Escape; lock background scroll while open.
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

  const groups = data ?? [];
  const isEmpty = !isLoading && flattenConnections(groups).length === 0;

  const fmtLastSync = (ts: number | null) =>
    ts == null
      ? t("sync.neverSynced")
      : t("sync.lastSync", { when: new Date(ts).toLocaleString(i18n.language) });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("sync.title")}
        onClick={(e) => e.stopPropagation()}
        className="relative w-140 max-w-[90vw] max-h-[80vh] bg-surface rounded-3xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2 shrink-0">
          <h2 className="text-xl font-semibold text-fg">{t("sync.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body (scrolls) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-5">
          {isEmpty && <p className="text-fg-faint text-sm">{t("sync.empty")}</p>}
          {groups.map((g) => (
            <div key={g.providerKey} className="flex flex-col gap-3">
              <span className="text-fg-faint text-xs uppercase tracking-wide">
                {g.providerName}
              </span>
              {g.connections.map((c) => (
                <ConnectionRow
                  key={c.id}
                  conn={c}
                  fmtLastSync={fmtLastSync}
                  onSync={() => syncOne.mutate(c.id)}
                  pending={syncOne.isPending && syncOne.variables === c.id}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Footer (always visible) */}
        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-3 shrink-0 border-t border-surface-2">
          <Button
            variant="primary"
            onClick={() => syncAll.mutate()}
            disabled={isEmpty || syncAll.isPending}
          >
            {t("sync.syncAll")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConnectionRow({
  conn,
  fmtLastSync,
  onSync,
  pending,
}: {
  conn: SyncConnection;
  fmtLastSync: (ts: number | null) => string;
  onSync: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const isAwaiting = conn.status === "awaiting";
  const isSyncing = conn.status === "syncing" || isAwaiting || pending;
  const isError = conn.status === "error";

  return (
    <div className="bg-surface-2 rounded-2xl px-4 py-3.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg font-semibold text-[15px] truncate">
            {conn.displayName}
          </p>
          <p className={`text-xs ${isError ? "text-red" : "text-fg-faint"}`}>
            {isAwaiting
              ? t("sync.awaiting")
              : isSyncing
                ? t("sync.syncing")
                : isError
                  ? (conn.lastError ?? t("sync.error"))
                  : fmtLastSync(conn.lastSyncAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onSync}
          disabled={isSyncing}
          aria-label={isError ? t("common.retry") : t("sync.sync")}
          className="shrink-0 grid size-9 place-items-center rounded-xl bg-surface text-fg-dim hover:bg-hover hover:text-fg transition-colors duration-140 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
        </button>
      </div>
      {conn.accounts.length > 0 && (
        <ul className="flex flex-col divide-y divide-surface">
          {conn.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-1.5">
              <span className="text-fg-dim text-sm truncate">{a.name}</span>
              <span className="text-fg-faint text-xs shrink-0 ml-2">{a.typeLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

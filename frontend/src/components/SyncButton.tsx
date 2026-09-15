import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { useConnections } from "../api/hooks";
import { afterSyncFinished } from "../api/invalidate";
import { hasError, hasSyncing } from "../api/types";
import { SyncModal } from "./SyncModal";

// Global sync control: positioned top-right on every page. The icon spins while any
// connection is syncing; a red dot appears when any connection is in error.
export function SyncButton() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useConnections();
  const syncing = hasSyncing(data);
  const error = hasError(data);

  // When a sync finishes (syncing → idle), snapshots/values may have changed.
  // This is the ONLY place a completed sync is noticed: the sync mutations
  // answer 202 and the work happens in a detached task, so the connections poll
  // landing on 'ok' is the completion signal for every screen.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !syncing) afterSyncFinished(qc);
    wasSyncing.current = syncing;
  }, [syncing, qc]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("sync.openLabel")}
        className="absolute top-4 right-4 z-40 grid size-10 place-items-center rounded-xl bg-surface text-fg hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
      >
        <RefreshCw className={`size-5 ${syncing ? "animate-spin" : ""}`} />
        {error && (
          <span
            data-testid="sync-error-dot"
            className="absolute -top-px -right-px size-2 rounded-full bg-red ring-2 ring-bg"
          />
        )}
      </button>
      {open && <SyncModal onClose={() => setOpen(false)} />}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";

import { useConnections } from "../api/hooks";
import { hasError, hasSyncing } from "../api/types";
import { SyncModal } from "./SyncModal";

// Views whose values depend on synced data — refreshed once a sync settles.
const SYNC_DEPENDENT_KEYS = [
  ["net-worth"],
  ["distribution"],
  ["accounts"],
  ["account-series"],
  ["holdings"],
];

// Global sync control: fixed top-right on every page. The icon spins while any
// connection is syncing; a red dot appears when any connection is in error.
export function SyncButton() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useConnections();
  const syncing = hasSyncing(data);
  const error = hasError(data);

  // When a sync finishes (syncing → idle), snapshots/values may have changed —
  // refresh the dashboard/accounts/holdings views so they reflect the new data.
  const wasSyncing = useRef(false);
  useEffect(() => {
    if (wasSyncing.current && !syncing) {
      for (const queryKey of SYNC_DEPENDENT_KEYS) {
        qc.invalidateQueries({ queryKey });
      }
    }
    wasSyncing.current = syncing;
  }, [syncing, qc]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("sync.openLabel")}
        className="fixed top-4 right-4 z-40 grid size-10 place-items-center rounded-xl bg-surface text-fg hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
      >
        <RefreshCw className={`size-5 ${syncing ? "animate-spin" : ""}`} />
        {error && (
          <span
            data-testid="sync-error-dot"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red ring-2 ring-bg"
          />
        )}
      </button>
      {open && <SyncModal onClose={() => setOpen(false)} />}
    </>
  );
}

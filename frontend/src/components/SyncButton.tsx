import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useConnections } from "../api/hooks";
import { connectionIssues } from "../lib/connectionHealth";
import { flattenConnections, hasError, hasSyncing } from "../api/types";
import { SyncModal } from "./SyncModal";

// Global sync control: positioned top-right on every page. The icon spins while any
// connection is syncing; a red dot appears when any connection is in error.
//
// Vertical placement: it is centred in the band above the first surface, which
// every page builds the same way (see PageHeader): `main`'s own `pt-6` (24px),
// then the 32px title line, then 24px down to the first card. The 32px button
// starts at the same 24px → `top-6`, level with the title.
//
// Its size and inset are CSS variables (index.css) because a page whose header
// row reaches the right edge has to stay clear of it: `clear-sync-button`
// derives that margin from the same two numbers.
export function SyncButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data } = useConnections();
  const syncing = hasSyncing(data);
  const error = hasError(data);
  const warning = flattenConnections(data).some((conn) => connectionIssues(conn).length > 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("sync.openLabel")}
        className="absolute top-6 right-(--sync-button-inset) z-40 grid size-(--sync-button-size) place-items-center rounded-lg bg-surface-2 text-fg hover:bg-surface-3 hover:text-fg transition-colors duration-140 cursor-pointer"
      >
        <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
        {(error || warning) && (
          <span
            data-testid={error ? "sync-error-dot" : "sync-warning-dot"}
            className={`absolute -top-px -right-px size-2 rounded-full ${error ? "bg-red" : "bg-amber"} ring-2 ring-bg`}
          />
        )}
      </button>
      {open && <SyncModal onClose={() => setOpen(false)} />}
    </>
  );
}

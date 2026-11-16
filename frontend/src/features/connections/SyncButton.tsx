import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useConnections } from "../../api/connections";
import { anySyncing, overallAlert } from "../../lib/connectionState";
import { SyncModal } from "./SyncModal";

// Placed top-right on every page, centred in the band above the first surface (`pt-6` + 32px title + 24px gap), hence `top-6`.
// Size and inset are CSS variables (index.css) so `clear-sync-button` can keep right-aligned headers clear of it.
export function SyncButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data } = useConnections();
  const syncing = anySyncing(data);
  const alert = overallAlert(data);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("sync.openLabel")}
        className="absolute top-6 right-(--sync-button-inset) z-40 grid size-(--sync-button-size) place-items-center rounded-lg bg-surface-2 text-fg hover:bg-surface-3 hover:text-fg transition-colors duration-140 cursor-pointer"
      >
        <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
        {alert && (
          <span
            data-testid={alert === "error" ? "sync-error-dot" : "sync-warning-dot"}
            className={`absolute -top-px -right-px size-2 rounded-full ${alert === "error" ? "bg-red" : "bg-amber"} ring-2 ring-bg`}
          />
        )}
      </button>
      {open && <SyncModal onClose={() => setOpen(false)} />}
    </>
  );
}

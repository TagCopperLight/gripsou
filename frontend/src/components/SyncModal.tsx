import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { useConnections, useSyncAll } from "../api/hooks";
import { flattenConnections } from "../api/types";
import { Button } from "./Button";
import { ConnectionRow } from "./ConnectionRow";

type SyncModalProps = { onClose: () => void };

// Provider → connection → account tree. Capped at 80vh as a flex column so the
// body scrolls while the header and the "Sync all" footer stay visible.
export function SyncModal({ onClose }: SyncModalProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useConnections();
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
  const connCount = flattenConnections(groups).length;
  const isEmpty = !isLoading && connCount === 0;

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
        <div className="flex items-start justify-between px-6 pt-6 pb-2 shrink-0">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-fg">{t("sync.title")}</h2>
            {!isLoading && (
              <p className="text-xs text-fg-faint mt-0.5">
                {t("settings.connections.connectionsCount", { count: connCount })}
                <span className="mx-1.5">·</span>
                {t("settings.connections.providersCount", { count: groups.length })}
              </p>
            )}
          </div>
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

        {/* Footer (always visible) */}
        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-3 shrink-0 border-t border-surface-2">
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
        </div>
      </div>
    </div>
  );
}

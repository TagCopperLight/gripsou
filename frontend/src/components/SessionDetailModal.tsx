import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

import { Button } from "./Button";
import { formatDate, formatRelative } from "../lib/date";
import type { Session } from "../api/types";

type SessionDetailModalProps = {
  session: Session;
  /** Omitted for the current session, which can't revoke itself. */
  onRevoke?: () => void;
  revoking?: boolean;
  onClose: () => void;
};

// The phone list shows one summary line per session; the detail lives here so
// every row in that list can stay the same height.
export function SessionDetailModal({
  session,
  onRevoke,
  revoking = false,
  onClose,
}: SessionDetailModalProps) {
  const { t } = useTranslation();

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={session.device}
        onClick={(e) => e.stopPropagation()}
        className="relative w-120 max-w-[90vw] bg-surface rounded-3xl flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-2">
          <h2 className="text-xl font-semibold text-fg">{session.device}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="shrink-0 p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {session.current && (
              <span className="rounded-md bg-green-soft px-2 py-0.5 text-xs font-medium text-green">
                {t("settings.account.thisDevice")}
              </span>
            )}
            <span className="rounded-md bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-dim">
              {session.remembered
                ? t("settings.account.sessionRemembered")
                : t("settings.account.sessionSingle")}
            </span>
          </div>

          <dl className="flex flex-col gap-2 text-sm">
            <Row label={t("settings.account.sessionIp")} value={session.ip ?? "—"} />
            <Row
              label={t("settings.account.sessionLastActive")}
              value={formatRelative(session.lastActiveAt)}
            />
            <Row
              label={t("settings.account.sessionSignedIn")}
              value={formatDate(session.createdAt)}
            />
          </dl>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          {onRevoke && (
            <Button variant="danger" onClick={onRevoke} disabled={revoking}>
              {t("settings.account.revokeSession")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-fg-faint">{label}</dt>
      <dd className="truncate font-mono text-fg">{value}</dd>
    </div>
  );
}

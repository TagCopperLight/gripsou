import { useTranslation } from "react-i18next";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
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

  return (
    <Dialog
      title={session.device}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          {onRevoke && (
            <Button variant="danger" onClick={onRevoke} disabled={revoking}>
              {t("settings.account.revokeSession")}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
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
    </Dialog>
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

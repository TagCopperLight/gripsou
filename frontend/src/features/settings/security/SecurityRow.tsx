import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Fingerprint, Loader2, ShieldCheck, Smartphone } from "lucide-react";

import { Button } from "../../../ui/Button";
import { useMfaStatus } from "../../../api/auth";

export function SecurityRow({
  icon,
  on = false,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  /** The icon turns green: this protection is set up. */
  on?: boolean;
  title: string;
  hint?: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-140 ${on ? "bg-green-soft text-green" : "bg-surface-3 text-fg-dim"}`}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] text-fg">{title}</span>
        </span>
        {hint && <span className="text-sm text-fg-faint">{hint}</span>}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/** The authenticator app's row. `action` shows once two-factor's status is
 *  known. */
export function TotpRow({ action }: { action: ReactNode }) {
  const { t } = useTranslation();
  const on = useMfaStatus().data?.totp ?? false;
  const Icon = on ? ShieldCheck : Smartphone;
  return <MfaRow icon={<Icon className="size-4.5" strokeWidth={2} />} on={on} title={t("settings.account.twoFactor")} action={action} />;
}

/** The passkeys' row. `action` shows once two-factor's status is known. */
export function PasskeyRow({ hint, action }: { hint?: ReactNode; action: ReactNode }) {
  const { t } = useTranslation();
  const on = (useMfaStatus().data?.passkeys.length ?? 0) > 0;
  return (
    <MfaRow icon={<Fingerprint className="size-4.5" strokeWidth={2} />} on={on} title={t("passkeys.title")} hint={hint} action={action} />
  );
}

/** A row whose state comes from two-factor's status: a spinner while it
 *  loads, a retry once it failed. */
function MfaRow({ hint, action, ...row }: { icon: ReactNode; on: boolean; title: string; hint?: ReactNode; action: ReactNode }) {
  const { t } = useTranslation();
  const mfa = useMfaStatus();
  return (
    <SecurityRow
      {...row}
      hint={mfa.isError ? <span className="text-red">{t("common.loadFailed")}</span> : hint}
      action={
        mfa.data ? (
          action
        ) : mfa.isError ? (
          <Button variant="ghostStrong" onClick={() => void mfa.refetch()}>
            {t("common.retry")}
          </Button>
        ) : (
          <Loader2 aria-label={t("common.loading")} className="size-4.5 animate-spin text-fg-faint" />
        )
      }
    />
  );
}

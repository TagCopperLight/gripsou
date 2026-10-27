import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showError } from "../lib/errorToasts";
import { KeyRound } from "lucide-react";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { BackupCodes } from "./BackupCodes";
import { PasswordField } from "./PasswordField";
import { useReauthStep } from "./useReauthStep";
import { useMfaStatus, useRegenerateRecovery, useRemoveTotp } from "../api/hooks";

type View = "menu" | "newCodes" | "codes" | "turnOff";

/** Two-factor once it's on: new backup codes, or turning it off (from the
 *  switch). Both ask for the password first. */
export function ManageTwoFactorModal({
  onClose,
  start = "menu",
}: {
  onClose: () => void;
  /** "turnOff" when opened from the switch: straight to the password. */
  start?: "menu" | "turnOff";
}) {
  const { t } = useTranslation();
  const { data: status } = useMfaStatus();
  const [view, setView] = useState<View>(start);
  const { password, setPassword, error, setError, checking, check } = useReauthStep();
  const [codes, setCodes] = useState<string[]>([]);

  const regenerate = useRegenerateRecovery();
  const remove = useRemoveTotp();
  const busy = checking || regenerate.isPending || remove.isPending;

  const open = (next: View) => {
    setPassword("");
    setError(null);
    setView(next);
  };

  const submit = async () => {
    if (!password || busy) return;
    const token = await check();
    if (!token) return;
    try {
      if (view === "newCodes") {
        setCodes((await regenerate.mutateAsync(token)).recoveryCodes);
        setView("codes");
      } else {
        await remove.mutateAsync(token);
        onClose();
      }
    } catch {
      showError(t(view === "newCodes" ? "twoFactor.newCodesFailed" : "twoFactor.removeFailed"));
    }
  };

  if (view === "menu") {
    return (
      <Dialog key="menu" title={t("twoFactor.manageTitle")} onClose={onClose}>
        <div className="flex flex-col gap-3 pb-2">
          <div className="flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-dim">
              <KeyRound className="size-4.5" strokeWidth={2} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] text-fg">{t("twoFactor.backupCodes")}</span>
              {status && (
                <span className="text-sm text-fg-faint">
                  {t("twoFactor.codesLeft", { count: status.recoveryRemaining })}
                </span>
              )}
            </div>
            <Button variant="ghostStrong" onClick={() => open("newCodes")}>
              {t("twoFactor.newCodes")}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  if (view === "codes") {
    return (
      <Dialog
        key="codes"
        title={t("twoFactor.codesTitle")}
        onClose={onClose}
        footer={<Button onClick={onClose}>{t("twoFactor.done")}</Button>}
      >
        <BackupCodes codes={codes} />
      </Dialog>
    );
  }

  const turningOff = view === "turnOff";
  return (
    <Dialog
      key={view}
      title={turningOff ? t("twoFactor.turnOffTitle") : t("twoFactor.newCodesTitle")}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={() => (start === "turnOff" ? onClose() : open("menu"))}>
            {t("common.cancel")}
          </Button>
          <Button variant={turningOff ? "danger" : "primary"} onClick={() => void submit()} disabled={!password || busy}>
            {turningOff ? t("twoFactor.turnOff") : t("twoFactor.continue")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {turningOff && <p className="text-sm text-fg-dim">{t("twoFactor.turnOffBody")}</p>}
        <PasswordField value={password} onChange={setPassword} />
        {error && <p className="text-sm text-red">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { BackupCodesView } from "./BackupCodesView";
import { useTotpConfirm, useTotpSetup } from "../api/hooks";
import { ApiError } from "../api/client";
import { sixDigits, throttleMinutes } from "../lib/mfa";

type Step = "scan" | "code" | "codes";

/** Three steps: scan the QR code (or type the key), prove the app produces a
 *  valid code, then keep the backup codes. `reauth` is the single-use token
 *  from ReauthModal that the setup call spends. */
export function TotpSetupModal({
  reauth,
  onClose,
  onReauthExpired,
}: {
  reauth: string;
  onClose: () => void;
  onReauthExpired: () => void;
}) {
  const { t } = useTranslation();
  const setup = useTotpSetup();
  const confirm = useTotpConfirm();
  const [step, setStep] = useState<Step>("scan");
  const [code, setCode] = useState("");
  const [error, setError] = useState<null | "invalid" | { minutes: number }>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  // The token is single use: StrictMode runs effects twice in development, and
  // a second call would be refused.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    setup.mutate(reauth);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  const setupStatus = setup.error instanceof ApiError ? setup.error.status : null;
  useEffect(() => {
    if (setupStatus === 401) onReauthExpired();
  }, [setupStatus, onReauthExpired]);

  const busy = setup.isPending || confirm.isPending || step === "codes";

  useEffect(() => {
    if (step === "code" && !confirm.isPending) codeRef.current?.focus();
  }, [step, confirm.isPending]);

  const verify = (value: string) => {
    setError(null);
    confirm.mutate(value, {
      onSuccess: () => setStep("codes"),
      onError: (err) => {
        const minutes = throttleMinutes(err);
        setError(minutes === null ? "invalid" : { minutes });
        setCode("");
      },
    });
  };

  const onCodeChange = (raw: string) => {
    const digits = sixDigits(raw);
    setCode(digits);
    if (digits.length === 6) verify(digits);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length === 6 && !confirm.isPending) verify(code);
  };

  const data = setup.data;
  const failed = setup.isError && setupStatus !== 401;

  return (
    <Dialog
      title={t("settings.security.setupTitle")}
      // At the last step the codes are shown only once: the button is the way out.
      onClose={step === "codes" ? () => {} : onClose}
      busy={busy}
      footer={
        step === "codes" ? (
          <Button type="button" onClick={onClose}>
            {t("settings.security.savedThem")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            {step === "scan" && (
              <Button type="button" onClick={() => setStep("code")} disabled={!data}>
                {t("settings.security.next")}
              </Button>
            )}
          </>
        )
      }
    >
      {step === "scan" && (
        <div className="flex flex-col items-center gap-4">
          {failed && <p className="text-sm text-red">{t("settings.security.actionFailed")}</p>}
          {!data && !failed && <p className="text-sm text-fg-faint">{t("common.loading")}</p>}
          {data && (
            <>
              <p className="self-start text-sm text-fg-dim">{t("settings.security.scanInstructions")}</p>
              <img
                src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(data.qrSvg)}
                alt={t("settings.security.qrAlt")}
                className="size-48 rounded-xl bg-white p-2"
              />
              <div className="flex w-full flex-col gap-1">
                <span className="text-sm text-fg-faint">{t("settings.security.secretKey")}</span>
                <code className="select-all break-all rounded-xl bg-surface-2 px-4 py-3 font-mono text-[15px] text-fg">
                  {data.secret.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ")}
                </code>
              </div>
            </>
          )}
        </div>
      )}
      {step === "code" && (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-fg-dim">{t("settings.security.enterCode")}</p>
          <label className="flex flex-col gap-2">
            <span className="text-sm text-fg-faint">{t("auth.codeLabel")}</span>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              disabled={confirm.isPending}
              className="h-10.25 w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green disabled:opacity-40"
            />
          </label>
          {error === "invalid" && <p className="text-sm text-red">{t("auth.invalidCode")}</p>}
          {error !== null && typeof error === "object" && (
            <p className="text-sm text-red">{t("auth.tooManyAttempts", { count: error.minutes })}</p>
          )}
        </form>
      )}
      {step === "codes" && confirm.data && <BackupCodesView codes={confirm.data.recoveryCodes} />}
    </Dialog>
  );
}

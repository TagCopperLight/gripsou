import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showError } from "../lib/errorToasts";
import { Copy, Check } from "lucide-react";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { ApiError } from "../api/client";
import { useTotpConfirm, useTotpSetup } from "../api/hooks";
import type { TotpSetup } from "../api/types";
import { throttleMinutes } from "../lib/mfa";
import { CodeInput } from "./CodeInput";
import { BackupCodes } from "./BackupCodes";
import { FieldError } from "./FieldError";
import { PasswordField } from "./PasswordField";
import { useReauthStep } from "./useReauthStep";

type Step = "password" | "scan" | "code" | "codes";
const STEPS: Step[] = ["password", "scan", "code", "codes"];

/** The setup key in groups of four, easier to type into an app by hand. */
function groups(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/** Turning two-factor on: password, scan, first code, backup codes. */
export function TotpSetupModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("password");
  const { password, setPassword, error, setError, checking, check } = useReauthStep();
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [keyCopied, setKeyCopied] = useState(false);

  const start = useTotpSetup();
  const confirm = useTotpConfirm();
  const busy = checking || start.isPending || confirm.isPending;

  /** Throttled, or `typed` (what the user typed was wrong), next to the
   *  field; anything else failed on the server's side. */
  const fail = (err: unknown, typed: string | null = null) => {
    const minutes = throttleMinutes(err);
    if (minutes !== null) setError(t("auth.tooManyAttempts", { count: minutes }));
    else if (typed) setError(typed);
    else showError(t("twoFactor.setupFailed"));
  };

  const submitPassword = async () => {
    if (!password || busy) return;
    const token = await check();
    if (!token) return;
    try {
      setSetup(await start.mutateAsync(token));
      setStep("scan");
    } catch (err) {
      fail(err);
    }
  };

  const submitCode = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setError(null);
    try {
      const res = await confirm.mutateAsync(value);
      setRecoveryCodes(res.recoveryCodes);
      setStep("codes");
    } catch (err) {
      // 409: the setup expired (10 minutes) and has to start over.
      if (err instanceof ApiError && err.status === 409) {
        setStep("password");
        setPassword("");
        setCode("");
        setError(t("twoFactor.expired"));
        return;
      }
      // Empty the boxes so the next code can be typed straight away.
      setCode("");
      fail(err, err instanceof ApiError && err.status === 400 ? t("twoFactor.wrongCode") : null);
    }
  };

  const copyKey = async (secret: string) => {
    await navigator.clipboard.writeText(secret);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 1500);
  };

  const index = STEPS.indexOf(step);
  const progress = (
    <span role="img" className="flex gap-1.5" aria-label={t("twoFactor.stepOf", { step: index + 1, total: STEPS.length })}>
      {STEPS.map((s, i) => (
        <span key={s} className={`h-1.5 w-5 rounded-full ${i <= index ? "bg-green" : "bg-surface-3"}`} />
      ))}
    </span>
  );

  let body;
  let footer;
  if (step === "password") {
    body = (
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submitPassword(); }}>
        <PasswordField value={password} onChange={setPassword} autoFocus error={error} />
        <button type="submit" hidden />
      </form>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button onClick={() => void submitPassword()} disabled={!password || busy}>{t("twoFactor.continue")}</Button>
      </>
    );
  } else if (step === "scan" && setup) {
    body = (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-fg-dim">{t("twoFactor.scanIntro")}</p>
        <div className="flex justify-center">
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt={t("twoFactor.qrAlt")} className="size-44 rounded-xl" />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg-faint">{t("twoFactor.cantScan")}</span>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 py-1.5 pr-1.5 pl-4">
            <span className="font-mono text-[13px] text-fg-dim">{groups(setup.secret)}</span>
            <button
              type="button"
              onClick={() => void copyKey(setup.secret)}
              aria-label={t("twoFactor.copyKey")}
              className="cursor-pointer rounded-lg p-1.5 text-fg-faint transition-colors duration-140 hover:bg-surface-3 hover:text-fg"
            >
              {keyCopied ? <Check className="size-4 text-green" /> : <Copy className="size-4" />}
            </button>
          </div>
        </div>
      </div>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button onClick={() => setStep("code")}>{t("twoFactor.next")}</Button>
      </>
    );
  } else if (step === "code") {
    body = (
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submitCode(); }}>
        <p className="text-sm text-fg-dim">{t("twoFactor.codeIntro")}</p>
        <div className="flex flex-col gap-2">
          <CodeInput
            ariaLabel={t("twoFactor.codeLabel")}
            value={code}
            autoFocus
            invalid={Boolean(error)}
            onChange={(digits) => {
              setCode(digits);
              setError(null);
              // The sixth digit sends it; there is no button for it.
              if (digits.length === 6) void submitCode(digits);
            }}
          />
          {error && <FieldError>{error}</FieldError>}
        </div>
        <button type="submit" hidden />
      </form>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={() => { setError(null); setStep("scan"); }}>{t("twoFactor.back")}</Button>
      </>
    );
  } else {
    body = <BackupCodes codes={recoveryCodes} />;
    footer = <Button onClick={onClose}>{t("twoFactor.done")}</Button>;
  }

  return (
    <Dialog
      // One dialog per step, so focus lands on each step's first control.
      key={step}
      title={step === "codes" ? t("twoFactor.codesTitle") : t("twoFactor.setupTitle")}
      onClose={onClose}
      busy={busy}
      aside={progress}
      footer={footer}
    >
      {body}
    </Dialog>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check } from "lucide-react";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { ApiError } from "../api/client";
import { useReauth, useTotpConfirm, useTotpSetup } from "../api/hooks";
import type { TotpSetup } from "../api/types";
import { throttleMinutes } from "../lib/mfa";
import { CodeInput } from "./CodeInput";
import { BackupCodes } from "./BackupCodes";

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
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const reauth = useReauth();
  const start = useTotpSetup();
  const confirm = useTotpConfirm();
  const busy = reauth.isPending || start.isPending || confirm.isPending;

  const fail = (err: unknown, otherwise: string) => {
    const minutes = throttleMinutes(err);
    setError(minutes !== null ? t("auth.tooManyAttempts", { count: minutes }) : otherwise);
  };

  const submitPassword = async () => {
    if (!password || busy) return;
    setError(null);
    let token: string;
    try {
      token = (await reauth.mutateAsync(password)).reauth;
    } catch (err) {
      fail(err, err instanceof ApiError && err.status === 400 ? t("twoFactor.wrongPassword") : t("twoFactor.failed"));
      return;
    }
    try {
      setSetup(await start.mutateAsync(token));
      setStep("scan");
    } catch (err) {
      fail(err, t("twoFactor.failed"));
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
      fail(err, err instanceof ApiError && err.status === 400 ? t("twoFactor.wrongCode") : t("twoFactor.failed"));
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

  const errorLine = error && <p className="text-sm text-red">{error}</p>;
  const inputClass =
    "h-10.25 w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green";

  let body;
  let footer;
  if (step === "password") {
    body = (
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submitPassword(); }}>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg-faint">{t("settings.account.currentPassword")}</span>
          <input type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </label>
        {errorLine}
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
        <CodeInput
          ariaLabel={t("twoFactor.codeLabel")}
          value={code}
          autoFocus
          onChange={(digits) => {
            setCode(digits);
            setError(null);
            // The sixth digit sends it; there is no button for it.
            if (digits.length === 6) void submitCode(digits);
          }}
        />
        {errorLine}
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

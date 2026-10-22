import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../components/Button";
import { useAuth } from "../auth/context";
import { ApiError } from "../api/client";
import { sixDigits, throttleMinutes } from "../lib/mfa";
import type { MfaRequired } from "../api/types";

export function Login() {
  const { t } = useTranslation();
  const { login, verifyLogin } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  // null, a named error, or a throttle wait in whole minutes.
  const [error, setError] = useState<
    null | "credentials" | "invalidCode" | "expired" | "failed" | { minutes: number }
  >(null);
  const [pending, setPending] = useState(false);
  // Set once the password was right and the account asks for a second factor.
  const [mfa, setMfa] = useState<MfaRequired | null>(null);
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  // Focus the code field on entering the step, on switching kind and after each
  // request (a disabled field loses focus while it is pending).
  useEffect(() => {
    if (mfa && !pending) codeRef.current?.focus();
  }, [mfa, useBackup, pending]);

  const throttled = (err: unknown) => {
    const minutes = throttleMinutes(err);
    return minutes === null ? null : { minutes };
  };

  const backToPassword = (next: typeof error = null) => {
    setMfa(null);
    setUseBackup(false);
    setCode("");
    setPassword("");
    setError(next);
  };

  const verify = async (value: string) => {
    if (!mfa) return;
    setError(null);
    setPending(true);
    try {
      await verifyLogin(mfa.challenge, useBackup ? { recoveryCode: value } : { totp: value }, remember);
    } catch (err) {
      const wait = throttled(err);
      if (wait) {
        setError(wait);
      } else if (err instanceof ApiError && err.status === 401) {
        backToPassword("expired");
      } else if (err instanceof ApiError && err.status === 400) {
        setError("invalidCode");
      } else {
        // A server or network failure says nothing about the code.
        setError("failed");
      }
      setCode("");
    } finally {
      setPending(false);
    }
  };

  const onCodeChange = (raw: string) => {
    if (useBackup) {
      setCode(raw);
      return;
    }
    const digits = sixDigits(raw);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    // An authenticator code is sent only once complete (typing the sixth
    // digit sends it): a short one would just spend a throttled attempt.
    if (useBackup ? code.trim() : code.length === 6) void verify(code.trim());
  };

  // No navigation here: a successful login flips auth, and the /login route
  // guard redirects to the dashboard once the router context refreshes.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await login(email, password, remember);
      if (res) {
        setMfa(res);
        setCode("");
        setUseBackup(false);
      }
    } catch (err) {
      setError(throttled(err) ?? "credentials");
    } finally {
      setPending(false);
    }
  };

  const errorLine = (
    <>
      {error === "credentials" && <p className="text-sm text-red">{t("auth.invalidCredentials")}</p>}
      {error === "invalidCode" && <p className="text-sm text-red">{t("auth.invalidCode")}</p>}
      {error === "expired" && <p className="text-sm text-red">{t("auth.challengeExpired")}</p>}
      {error === "failed" && <p className="text-sm text-red">{t("settings.security.actionFailed")}</p>}
      {error !== null && typeof error === "object" && (
        <p className="text-sm text-red">{t("auth.tooManyAttempts", { count: error.minutes })}</p>
      )}
    </>
  );
  const inputClass =
    "w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green h-10.25 disabled:opacity-40";
  const linkClass = "self-start text-sm text-fg-dim hover:text-fg disabled:opacity-40";

  if (mfa) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-10">
        <div className="w-100 max-w-full">
          <div className="mb-8 sm:mb-15 text-center whitespace-nowrap font-wordmark text-[clamp(2.5rem,15vw,75px)] font-semibold tracking-tight text-fg">
            gripsou
          </div>
          <form onSubmit={submitCode} className="flex flex-col gap-4 rounded-3xl bg-surface p-6">
            <div className="flex flex-col pb-1">
              <div className="text-lg font-semibold text-fg">{t("auth.twoFactorTitle")}</div>
              <div className="text-sm text-fg-faint">
                {useBackup ? t("auth.enterBackupCode") : t("auth.enterCode")}
              </div>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm text-fg-dim">
                {useBackup ? t("auth.backupCode") : t("auth.codeLabel")}
              </span>
              <input
                key={useBackup ? "backup" : "totp"}
                ref={codeRef}
                type="text"
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                disabled={pending}
                autoFocus
                {...(useBackup
                  ? { autoComplete: "off" }
                  : { inputMode: "numeric" as const, autoComplete: "one-time-code", maxLength: 6 })}
                className={inputClass}
              />
            </label>
            {errorLine}
            {useBackup && (
              <Button type="submit" disabled={pending} className="mt-1">
                {t("auth.verify")}
              </Button>
            )}
            {mfa.methods.includes("recovery") && (
              <button
                type="button"
                disabled={pending}
                className={linkClass}
                onClick={() => {
                  setUseBackup(!useBackup);
                  setCode("");
                  setError(null);
                }}
              >
                {useBackup ? t("auth.useAuthenticator") : t("auth.useBackupCode")}
              </button>
            )}
            <button type="button" disabled={pending} className={linkClass} onClick={() => backToPassword()}>
              {t("auth.back")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-10">
      <div className="w-100 max-w-full">
        <div className="mb-8 sm:mb-15 text-center whitespace-nowrap font-wordmark text-[clamp(2.5rem,15vw,75px)] font-semibold tracking-tight text-fg">
          gripsou
        </div>
        <form
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-3xl bg-surface p-6"
        >
          <div className="flex flex-col pb-1">
            <div className="text-lg font-semibold text-fg">
              {t("auth.welcomeBack")}
            </div>
            <div className="text-sm text-fg-faint">
              {t("auth.signInToContinue")}
            </div>
          </div>
          <label className="flex flex-col gap-2">
            <span className="text-sm text-fg-dim">{t("auth.email")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green h-10.25"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm text-fg-dim">{t("auth.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-surface-2 px-4 py-3 text-fg outline-none focus:ring-1 focus:ring-green h-10.25"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-dim">
            <span className="relative inline-flex h-5 w-9 shrink-0 rounded-full bg-surface-3 transition-colors has-checked:bg-green">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="peer sr-only"
              />
              <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-fg transition-transform peer-checked:translate-x-4" />
            </span>
            {t("auth.rememberMe")}
          </label>
          {errorLine}
          <Button type="submit" disabled={pending} className="mt-1">
            {t("auth.signIn")}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-fg-faint sm:text-sm">
          {t("auth.inviteOnly1")}
          <br />
          <Trans
            i18nKey="auth.inviteOnly2"
            components={{ 1: <span className="text-fg-dim" /> }}
          />
        </p>
      </div>
    </div>
  );
}

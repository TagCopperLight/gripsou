import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Fingerprint, LoaderCircle } from "lucide-react";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { Button } from "../components/Button";
import { CodeInput } from "../components/CodeInput";
import { useAuth } from "../auth/context";
import { ApiError } from "../api/client";
import { throttleMinutes } from "../lib/mfa";

type Step = "password" | "passwordless" | "code" | "backup";

export function Login() {
  const { t } = useTranslation();
  const { login, loginWithPasskey, verifyLogin } = useAuth();

  const [step, setStep] = useState<Step>("password");
  // The step a passwordless sign-in was started from, to go back to.
  const [passkeyFrom, setPasskeyFrom] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  // The second step's challenge, from a password the server accepted.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tooMany = (err: unknown) => {
    const minutes = throttleMinutes(err);
    return minutes === null ? null : t("auth.tooManyAttempts", { count: minutes });
  };

  const backToPassword = (message: string | null = null) => {
    setStep("password");
    setChallenge(null);
    setPassword("");
    setCode("");
    setBackupCode("");
    setError(message);
  };

  // No navigation here: a successful login flips auth, and the /login route
  // guard redirects to the dashboard once the router context refreshes.
  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const mfa = await login(email, password, remember);
      if (mfa) {
        setChallenge(mfa.challenge);
        setStep("code");
      }
    } catch (err) {
      setError(tooMany(err) ?? t("auth.invalidCredentials"));
    } finally {
      setPending(false);
    }
  };

  /** Sign in with a passkey alone, from the password form or in place of the
   *  code. Cancelled, it goes back where it started without a message;
   *  refused, it says so there. */
  const signInWithPasskey = async () => {
    const from = step;
    setPasskeyFrom(from);
    setError(null);
    setStep("passwordless");
    try {
      await loginWithPasskey(remember);
    } catch (err) {
      setStep(from);
      // 401: the sign-in's challenge expired while the browser window was open.
      if (err instanceof ApiError) {
        setError(
          tooMany(err) ??
            (err.status === 400 || err.status === 401 ? t("auth.mfa.passkeyRefused") : t("auth.mfa.failed")),
        );
      }
    }
  };

  const verify = async (secret: { totp: string } | { recoveryCode: string }) => {
    if (!challenge || pending) return;
    setError(null);
    setPending(true);
    try {
      await verifyLogin(challenge, secret, remember);
    } catch (err) {
      // 401: the challenge expired (5 minutes) or was used up; start over.
      if (err instanceof ApiError && err.status === 401) {
        backToPassword(t("auth.mfa.expired"));
        return;
      }
      setCode("");
      setError(
        tooMany(err) ??
          (err instanceof ApiError && err.status === 400 ? t("auth.mfa.wrongCode") : t("auth.mfa.failed")),
      );
    } finally {
      setPending(false);
    }
  };

  const switchTo = (next: Step) => {
    WebAuthnAbortService.cancelCeremony();
    setError(null);
    setCode("");
    setBackupCode("");
    setStep(next);
  };

  const errorLine = error && <p className="text-sm text-red">{error}</p>;
  const inputClass =
    "w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green h-10.25";

  // The account being signed into, with a way back to the password. Leaving
  // a step is disabled while its code is checked, so the answer can't land on
  // another one.
  const account = (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm text-fg-dim">{email}</span>
      <button
        type="button"
        onClick={() => backToPassword()}
        disabled={pending}
        className="cursor-pointer text-sm font-medium text-fg transition-opacity duration-140 hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("auth.mfa.change")}
      </button>
    </div>
  );
  const switchLink = (label: string, next: Step) => (
    <button
      type="button"
      onClick={() => switchTo(next)}
      disabled={pending}
      className="cursor-pointer self-center pt-1 text-sm font-medium text-fg-dim transition-colors duration-140 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );

  const orDivider = (
    <div className="flex items-center gap-3 text-xs text-fg-faint">
      <span className="h-px flex-1 bg-surface-3" />
      {t("auth.mfa.or")}
      <span className="h-px flex-1 bg-surface-3" />
    </div>
  );
  const passkeyButton = (
    <button
      type="button"
      onClick={() => void signInWithPasskey()}
      disabled={pending}
      className="flex h-10.25 cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface-2 text-sm font-medium text-fg transition-colors duration-140 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Fingerprint className="size-4.5" strokeWidth={2} />
      {t("auth.signInWithPasskey")}
    </button>
  );

  let card;
  if (step === "code") {
    card = (
      <div className="flex flex-col gap-4 rounded-3xl bg-surface p-6">
        <div className="pb-1 text-lg font-semibold text-fg">{t("auth.mfa.codeTitle")}</div>
        {account}
        <CodeInput
          ariaLabel={t("auth.mfa.codeLabel")}
          value={code}
          autoFocus
          onChange={(digits) => {
            setCode(digits);
            setError(null);
            if (digits.length === 6) void verify({ totp: digits });
          }}
        />
        {errorLine}
        {orDivider}
        {passkeyButton}
        {switchLink(t("auth.mfa.useBackup"), "backup")}
      </div>
    );
  } else if (step === "passwordless") {
    card = (
      <div className="flex flex-col gap-4 rounded-3xl bg-surface p-6">
        <div className="pb-1 text-lg font-semibold text-fg">{t("auth.signInWithPasskey")}</div>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <LoaderCircle className="size-8 animate-spin text-green" />
          <p className="text-lg font-semibold text-fg">{t("passkeys.waiting")}</p>
        </div>
        {passkeyFrom === "code"
          ? switchLink(t("auth.mfa.useCode"), "code")
          : switchLink(t("auth.usePassword"), "password")}
      </div>
    );
  } else if (step === "backup") {
    card = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (backupCode.trim()) void verify({ recoveryCode: backupCode.trim() });
        }}
        className="flex flex-col gap-4 rounded-3xl bg-surface p-6"
      >
        <div className="pb-1 text-lg font-semibold text-fg">{t("auth.mfa.backupTitle")}</div>
        {account}
        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg-dim">{t("auth.mfa.backupLabel")}</span>
          <input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={backupCode}
            onChange={(e) => {
              setBackupCode(e.target.value);
              setError(null);
            }}
            placeholder="xxxxx-xxxxx"
            className={`${inputClass} font-mono placeholder:text-fg-faint/50`}
          />
        </label>
        {errorLine}
        <Button type="submit" disabled={pending || !backupCode.trim()} className="mt-1">
          {t("auth.signIn")}
        </Button>
        {switchLink(t("auth.mfa.useApp"), "code")}
      </form>
    );
  } else {
    card = (
      <form onSubmit={submitPassword} className="flex flex-col gap-4 rounded-3xl bg-surface p-6">
        <div className="flex flex-col pb-1">
          <div className="text-lg font-semibold text-fg">{t("auth.welcomeBack")}</div>
          <div className="text-sm text-fg-faint">{t("auth.signInToContinue")}</div>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg-dim">{t("auth.email")}</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg-dim">{t("auth.password")}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
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
        {orDivider}
        {passkeyButton}
      </form>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 py-10">
      <div className="w-100 max-w-full">
        <div className="mb-8 sm:mb-15 text-center whitespace-nowrap font-wordmark text-[clamp(2.5rem,15vw,75px)] font-semibold tracking-tight text-fg">
          gripsou
        </div>
        {card}
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

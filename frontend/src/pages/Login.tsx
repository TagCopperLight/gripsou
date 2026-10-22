import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../components/Button";
import { CodeInput } from "../components/CodeInput";
import { useAuth } from "../auth/context";
import { ApiError } from "../api/client";
import { throttleMinutes } from "../lib/mfa";

type Step = "password" | "code" | "backup";

export function Login() {
  const { t } = useTranslation();
  const { login, verifyLogin } = useAuth();

  const [step, setStep] = useState<Step>("password");
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
    setError(null);
    setCode("");
    setBackupCode("");
    setStep(next);
  };

  const errorLine = error && <p className="text-sm text-red">{error}</p>;
  const inputClass =
    "w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green h-10.25";

  // The account being signed into, with a way back to the password.
  const account = (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-2.5">
      <span className="min-w-0 flex-1 truncate text-sm text-fg-dim">{email}</span>
      <button
        type="button"
        onClick={() => backToPassword()}
        className="cursor-pointer text-sm font-medium text-fg transition-opacity duration-140 hover:opacity-70"
      >
        {t("auth.mfa.change")}
      </button>
    </div>
  );
  const switchLink = (label: string, next: Step) => (
    <button
      type="button"
      onClick={() => switchTo(next)}
      className="cursor-pointer self-center pt-1 text-sm font-medium text-fg-dim transition-colors duration-140 hover:text-fg"
    >
      {label}
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
        {switchLink(t("auth.mfa.useBackup"), "backup")}
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

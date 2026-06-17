import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button";
import { useAuth } from "../auth/context";

export function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  // No navigation here: a successful login flips auth, and the /login route
  // guard redirects to the dashboard once the router context refreshes.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setPending(true);
    try {
      await login(email, password, remember);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="relative">
        <div className="absolute bottom-full left-1/2 mb-15 -translate-x-1/2 whitespace-nowrap font-wordmark text-[75px] font-semibold tracking-tight text-fg">
          gripsou
        </div>
        <form
          onSubmit={submit}
          className="flex w-100 max-w-[90vw] flex-col gap-4 rounded-3xl bg-surface p-6"
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
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="size-4 accent-green"
            />
            {t("auth.rememberMe")}
          </label>
          {error && <p className="text-sm text-red">{t("auth.invalidCredentials")}</p>}
          <Button type="submit" disabled={pending} className="mt-1">
            {t("auth.signIn")}
          </Button>
        </form>
        <p className="absolute top-full left-1/2 mt-6 w-100 max-w-[90vw] -translate-x-1/2 px-2 text-center text-sm text-fg-faint">
          {t("auth.inviteOnly1")}
          <br />
          {t("auth.inviteOnly2")}
        </p>
      </div>
    </div>
  );
}

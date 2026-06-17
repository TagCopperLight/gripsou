import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../components/Button";
import { useAuth } from "../auth/context";

export function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setPending(true);
    try {
      await login(email, password);
      navigate({ to: "/" });
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-6">
        <div className="font-wordmark text-3xl font-semibold tracking-tight text-fg">
          gripsou
        </div>
        <form
          onSubmit={submit}
          className="flex w-80 max-w-[90vw] flex-col gap-4 rounded-3xl bg-surface p-6"
        >
          <label className="flex flex-col gap-2">
            <span className="text-sm text-fg-faint">{t("auth.email")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm text-fg-faint">{t("auth.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green"
            />
          </label>
          {error && <p className="text-sm text-red">{t("auth.invalidCredentials")}</p>}
          <Button type="submit" disabled={pending} className="mt-1">
            {t("auth.signIn")}
          </Button>
        </form>
      </div>
    </div>
  );
}

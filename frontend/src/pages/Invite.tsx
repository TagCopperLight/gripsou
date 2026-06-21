import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "../components/Button";
import { useAuth } from "../auth/context";
import { useTokenGuard } from "../auth/useTokenGuard";
import { postJson } from "../api/client";
import type { SessionUser } from "../api/types";

type RedeemResp = { token: string; user: SessionUser };

export function Invite() {
  const { t } = useTranslation();
  const { adoptSession } = useAuth();
  const navigate = useNavigate();
  const { token } = useParams({ strict: false }) as { token: string };
  const guard = useTokenGuard(token);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Render nothing until the token is confirmed valid (else the guard redirects).
  if (guard.status !== "valid") return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t("auth.passwordsDontMatch"));
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await postJson<RedeemResp>(
        `/auth/invite/${token}/redeem`,
        { email, name, password },
        { skipGlobalUnauthorized: true },
      );
      adoptSession(res.token, res.user);
      void navigate({ to: "/" });
    } catch (err: unknown) {
      const exists = err instanceof Error && err.message.includes("failed: 409");
      setError(exists ? t("auth.emailExists") : t("auth.invalidCredentials"));
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
            <div className="text-lg font-semibold text-fg">{t("auth.createAccount")}</div>
            <div className="text-sm text-fg-faint">{t("auth.setUpToContinue")}</div>
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
            <span className="text-sm text-fg-dim">{t("auth.name")}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
          <label className="flex flex-col gap-2">
            <span className="text-sm text-fg-dim">{t("auth.confirmPassword")}</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-xl bg-surface-2 px-4 py-3 text-fg outline-none focus:ring-1 focus:ring-green h-10.25"
            />
          </label>
          {error && <p className="text-sm text-red">{error}</p>}
          <Button type="submit" disabled={pending} className="mt-1">
            {t("auth.createAccountButton")}
          </Button>
        </form>
        <p className="absolute top-full left-1/2 mt-6 w-100 max-w-[90vw] -translate-x-1/2 px-2 text-center text-sm text-fg-faint">
          {t("auth.dataNotice")}
        </p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { AuthPage } from "../../ui/AuthPage";
import { Button } from "../../ui/Button";
import { showError } from "../../lib/errorToasts";
import { useAuth } from "../../auth/context";
import { useTokenGuard } from "../../auth/useTokenGuard";
import { ApiError } from "../../api/client";
import { authApi } from "../../api/auth";
import { NewAccountFields } from "./NewAccountFields";
import { EMPTY_ACCOUNT, newAccountProblem, type FieldProblem, type NewAccount } from "./newAccount";

const route = getRouteApi("/invite/$token");

export function Invite() {
  const { t } = useTranslation();
  const { adoptSession } = useAuth();
  const navigate = useNavigate();
  const { token } = route.useParams();
  const guard = useTokenGuard(token);

  const [account, setAccount] = useState<NewAccount>(EMPTY_ACCOUNT);
  const [error, setError] = useState<FieldProblem | null>(null);
  const [pending, setPending] = useState(false);

  // Render nothing until the token is confirmed valid (else the guard redirects).
  if (guard.status !== "valid") return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = newAccountProblem(t, account);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await authApi.redeemInvite(token, { email: account.email, name: account.name, password: account.password });
      adoptSession(res.token, res.user);
      void navigate({ to: "/" });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) setError({ text: t("auth.emailExists"), field: "email" });
      else showError(t("auth.signUpFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthPage note={t("auth.dataNotice")}>
      <form
        onSubmit={submit}
        // Typing again: the refused value is being fixed.
        onInput={() => setError(null)}
        className="flex flex-col gap-4 rounded-3xl bg-surface p-6"
      >
        <div className="pb-1 text-lg font-semibold text-fg">{t("auth.createAccount")}</div>
        <NewAccountFields account={account} onChange={setAccount} error={error} />
        <Button type="submit" disabled={pending} className="mt-1">
          {t("auth.createAccountButton")}
        </Button>
      </form>
    </AuthPage>
  );
}

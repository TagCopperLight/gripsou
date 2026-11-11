import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { AuthPage } from "../../ui/AuthPage";
import { Button } from "../../ui/Button";
import { CardState } from "../../ui/CardState";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextInput";
import { showError } from "../../lib/errorToasts";
import { useAuth } from "../../auth/context";
import { throttledError } from "../../auth/throttle";
import { ApiError } from "../../api/client";
import { keys } from "../../api/keys";
import { setupApi, useSetupStatus } from "../../api/setup";
import type { SetupStatus } from "../../api/wire";
import { NewAccountFields } from "../auth/NewAccountFields";
import { EMPTY_ACCOUNT, newAccountProblem, type FieldProblem, type NewAccountField } from "../auth/newAccount";

type SetupField = NewAccountField | "code";

/** The first account, made with the code the server printed when it started
 *  on an empty database. It is the administrator. */
export function Setup() {
  const { t } = useTranslation();
  const id = useId();
  const { adoptSession } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useSetupStatus();

  const [code, setCode] = useState("");
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [error, setError] = useState<FieldProblem<SetupField> | null>(null);
  const [pending, setPending] = useState(false);

  const closed = status.data?.needed === false;
  useEffect(() => {
    if (closed) void navigate({ to: "/login", replace: true });
  }, [closed, navigate]);

  if (status.isError) {
    return (
      <AuthPage>
        <CardState variant="error" onRetry={() => void status.refetch()} className="rounded-3xl bg-surface p-6" />
      </AuthPage>
    );
  }
  if (!status.data?.needed) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem: FieldProblem<SetupField> | null = !code.trim()
      ? { field: "code", text: t("setup.enterCode") }
      : newAccountProblem(t, account);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await setupApi.create({ code, email: account.email, name: account.name, password: account.password });
      adoptSession(res.token, res.user);
      void navigate({ to: "/" });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        // Someone finished it first: the sign-in page must not send back here.
        qc.setQueryData<SetupStatus>(keys.setupStatus(), { needed: false });
        return;
      }
      const refused =
        throttledError(t, err) ?? (err instanceof ApiError && err.status === 401 ? t("setup.wrongCode") : null);
      if (refused) setError({ field: "code", text: refused });
      else showError(t("auth.signUpFailed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthPage>
      <form
        onSubmit={submit}
        // Typing again: the refused value is being fixed.
        onInput={() => setError(null)}
        className="flex flex-col gap-4 rounded-3xl bg-surface p-6"
      >
        <div className="flex flex-col gap-1 pb-1">
          <div className="text-lg font-semibold text-fg">{t("setup.title")}</div>
          <p className="text-sm text-fg-dim">{t("setup.adminNote")}</p>
        </div>
        <Field
          label={t("setup.code")}
          labelClassName="text-fg-dim"
          error={error?.field === "code" && error.text}
          htmlFor={`${id}-code`}
        >
          <TextInput
            id={`${id}-code`}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            invalid={error?.field === "code"}
            placeholder="XXXX-XXXX-XXXX"
            className="font-mono uppercase placeholder:text-fg-faint/50"
          />
          {error?.field !== "code" && <span className="text-xs text-fg-faint">{t("setup.codeHint")}</span>}
        </Field>
        <NewAccountFields account={account} onChange={setAccount} error={error} />
        <Button type="submit" disabled={pending} className="mt-1">
          {t("auth.createAccountButton")}
        </Button>
      </form>
    </AuthPage>
  );
}

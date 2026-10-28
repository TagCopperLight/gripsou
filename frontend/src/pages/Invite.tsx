import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AuthPage } from "../components/AuthPage";
import { Button } from "../components/Button";
import { LabeledField } from "../components/FieldError";
import { showError } from "../lib/errorToasts";
import { TextInput } from "../components/TextInput";
import { useAuth } from "../auth/context";
import { useTokenGuard } from "../auth/useTokenGuard";
import { passwordLengthOk } from "../lib/password";
import { ApiError, postJson } from "../api/client";
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
  // What was refused, and which field it's about.
  const [error, setError] = useState<{ text: string; field: "email" | "name" | "password" | "confirm" } | null>(null);
  const [pending, setPending] = useState(false);

  // Render nothing until the token is confirmed valid (else the guard redirects).
  if (guard.status !== "valid") return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The server refuses both empty; say so by the field instead.
    if (!email.trim()) {
      setError({ text: t("auth.enterEmail"), field: "email" });
      return;
    }
    if (!name.trim()) {
      setError({ text: t("auth.enterName"), field: "name" });
      return;
    }
    if (!passwordLengthOk(password)) {
      setError({ text: t("auth.passwordLength"), field: "password" });
      return;
    }
    if (password !== confirm) {
      setError({ text: t("auth.passwordsDontMatch"), field: "confirm" });
      return;
    }
    setError(null);
    setPending(true);
    try {
      const res = await postJson<RedeemResp>(
        `/auth/invite/${token}/redeem`,
        { email, name, password },
      );
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
        <LabeledField
          label={t("auth.email")}
          labelClassName="text-fg-dim"
          error={error?.field === "email" && error.text}
        >
          <TextInput
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={error?.field === "email"}
          />
        </LabeledField>
        <LabeledField
          label={t("auth.name")}
          labelClassName="text-fg-dim"
          error={error?.field === "name" && error.text}
        >
          <TextInput
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            invalid={error?.field === "name"}
          />
        </LabeledField>
        <LabeledField
          label={t("auth.password")}
          labelClassName="text-fg-dim"
          error={error?.field === "password" && error.text}
        >
          <TextInput
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={error?.field === "password" || error?.field === "confirm"}
          />
        </LabeledField>
        <LabeledField
          label={t("auth.confirmPassword")}
          labelClassName="text-fg-dim"
          error={error?.field === "confirm" && error.text}
        >
          <TextInput
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            invalid={error?.field === "confirm"}
          />
        </LabeledField>
        <Button type="submit" disabled={pending} className="mt-1">
          {t("auth.createAccountButton")}
        </Button>
      </form>
    </AuthPage>
  );
}

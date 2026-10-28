import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AuthPage } from "../components/AuthPage";
import { Button } from "../components/Button";
import { FieldError, LabeledField } from "../components/FieldError";
import { TextInput } from "../components/TextInput";
import { useAuth } from "../auth/context";
import { useTokenGuard } from "../auth/useTokenGuard";
import { passwordLengthOk } from "../lib/password";
import { ApiError, postJson } from "../api/client";
import { showError } from "../lib/errorToasts";
import type { SessionUser } from "../api/types";

type RedeemResp = { token: string; user: SessionUser };

export function Reset() {
  const { t } = useTranslation();
  const { adoptSession } = useAuth();
  const navigate = useNavigate();
  const { token } = useParams({ strict: false }) as { token: string };
  const guard = useTokenGuard(token);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // What was refused, and which field it's about (none: the form as a whole).
  const [error, setError] = useState<{ text: string; field: "password" | "confirm" | null } | null>(null);
  const [pending, setPending] = useState(false);

  if (guard.status !== "valid") return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        `/auth/reset/${token}/redeem`,
        { password },
      );
      adoptSession(res.token, res.user);
      void navigate({ to: "/" });
    } catch (err) {
      // 404: the link expired or was used meanwhile. Anything else failed on
      // the server's side, and mustn't blame the link.
      if (err instanceof ApiError && err.status === 404) setError({ text: t("auth.resetLinkInvalid"), field: null });
      else showError(t("auth.resetFailed"));
    } finally {
      setPending(false);
    }
  };

  const email = guard.info?.email ?? "";

  return (
    <AuthPage>
      <form
        onSubmit={submit}
        // Typing again: the refused value is being fixed.
        onInput={() => setError(null)}
        className="flex flex-col gap-4 rounded-3xl bg-surface p-6"
      >
        <div className="pb-1 text-lg font-semibold text-fg">{t("auth.resetPassword")}</div>
        {/* Whose password it is; the hidden copy tells a password manager
            which saved login to update. */}
        <div className="truncate rounded-xl bg-surface-2 px-4 py-2.5 text-sm text-fg-dim">{email}</div>
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <LabeledField
          label={t("auth.newPassword")}
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
        {error?.field === null && <FieldError>{error.text}</FieldError>}
        <Button type="submit" disabled={pending} className="mt-1">
          {t("auth.updatePasswordButton")}
        </Button>
      </form>
    </AuthPage>
  );
}

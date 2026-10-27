import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button } from "../components/Button";
import { FieldError, LabeledField } from "../components/FieldError";
import { TextInput } from "../components/TextInput";
import { useAuth } from "../auth/context";
import { useTokenGuard } from "../auth/useTokenGuard";
import { passwordLengthOk } from "../lib/password";
import { postJson } from "../api/client";
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
  const [error, setError] = useState<{ text: string; field: "email" | "password" | "confirm" | null } | null>(null);
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
    } catch {
      setError({ text: t("auth.resetLinkInvalid"), field: null });
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
          // Typing again: the refused value is being fixed.
          onInput={() => setError(null)}
          className="flex w-100 max-w-[90vw] flex-col gap-4 rounded-3xl bg-surface p-6"
        >
          <div className="flex flex-col pb-1">
            <div className="text-lg font-semibold text-fg">{t("auth.resetPassword")}</div>
            <div className="text-sm text-fg-faint">{t("auth.setUpToContinue")}</div>
            <div className="mt-1 text-sm font-medium text-fg-dim">{guard.info?.email}</div>
          </div>
          <LabeledField
            label={t("auth.newPassword")}
            labelClassName="text-fg-dim"
            error={error?.field === "password" && error.text}
          >
            <TextInput
              type="password"
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
      </div>
    </div>
  );
}

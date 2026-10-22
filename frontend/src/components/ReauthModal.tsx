import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { useReauth } from "../api/hooks";
import { ApiError } from "../api/client";
import { throttleMinutes } from "../lib/mfa";

/** Asks for the password again before a sensitive two-factor change, and hands
 *  the single-use token it earns to `onConfirmed`. */
export function ReauthModal({
  onConfirmed,
  onClose,
}: {
  onConfirmed: (reauth: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reauth = useReauth();
  const [password, setPassword] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === "" || reauth.isPending) return;
    reauth.mutate(password, { onSuccess: ({ reauth: token }) => onConfirmed(token) });
  };

  const minutes = throttleMinutes(reauth.error);
  const wrong = reauth.error instanceof ApiError && reauth.error.status === 400;

  return (
    <Dialog
      title={t("settings.security.reauthTitle")}
      onClose={onClose}
      busy={reauth.isPending}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose} disabled={reauth.isPending}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="reauth-form" disabled={password === "" || reauth.isPending}>
            {t("settings.security.confirm")}
          </Button>
        </>
      }
    >
      <form id="reauth-form" onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg-faint">{t("auth.password")}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={reauth.isPending}
            data-autofocus
            className="h-10.25 w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green disabled:opacity-40"
          />
        </label>
        {wrong && <p className="text-sm text-red">{t("settings.security.incorrectPassword")}</p>}
        {minutes !== null && (
          <p className="text-sm text-red">{t("auth.tooManyAttempts", { count: minutes })}</p>
        )}
        {reauth.isError && !wrong && minutes === null && (
          <p className="text-sm text-red">{t("settings.security.actionFailed")}</p>
        )}
      </form>
    </Dialog>
  );
}

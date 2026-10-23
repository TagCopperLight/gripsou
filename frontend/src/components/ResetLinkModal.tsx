import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { LinkModal } from "./LinkModal";
import { ApiError } from "../api/client";
import { useCreateResetLink, useReauth } from "../api/hooks";
import { throttleMinutes } from "../lib/mfa";
import type { User } from "../api/types";

/** A reset link for another user: the admin's password first (redeeming the
 *  link clears the user's second factors), then the link to share. */
export function ResetLinkModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const reauth = useReauth();
  const create = useCreateResetLink();
  const busy = reauth.isPending || create.isPending;

  const submit = async () => {
    if (!password || busy) return;
    setError(null);
    let proof: string;
    try {
      proof = (await reauth.mutateAsync(password)).reauth;
    } catch (err) {
      const minutes = throttleMinutes(err);
      setError(
        minutes !== null
          ? t("auth.tooManyAttempts", { count: minutes })
          : err instanceof ApiError && err.status === 400
            ? t("twoFactor.wrongPassword")
            : t("settings.users.linkError"),
      );
      return;
    }
    try {
      setToken((await create.mutateAsync({ id: user.id, reauth: proof })).token);
    } catch {
      setError(t("settings.users.linkError"));
    }
  };

  if (token) {
    return (
      <LinkModal
        title={t("settings.users.reset.title")}
        subtitle={t("settings.users.reset.heading")}
        body={t("settings.users.reset.body", { name: user.name })}
        link={`${window.location.origin}/reset/${token}`}
        error={false}
        onClose={onClose}
      />
    );
  }

  return (
    <Dialog
      title={t("settings.users.reset.title")}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => void submit()} disabled={!password || busy}>
            {t("settings.users.reset.create")}
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-sm text-fg-dim">{t("settings.users.reset.confirm", { name: user.name })}</p>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg-faint">{t("settings.account.currentPassword")}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10.25 w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green"
          />
        </label>
        {error && <p className="text-sm text-red">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

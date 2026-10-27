import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showError } from "../lib/errorToasts";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { LinkModal } from "./LinkModal";
import { PasswordField } from "./PasswordField";
import { useReauthStep } from "./useReauthStep";
import { useCreateResetLink } from "../api/hooks";
import type { User } from "../api/types";

/** A reset link for another user: the admin's password first (redeeming the
 *  link clears the user's second factors), then the link to share. */
export function ResetLinkModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useTranslation();
  const { password, setPassword, error, checking, check } = useReauthStep();
  const [token, setToken] = useState<string | null>(null);
  const create = useCreateResetLink();
  const busy = checking || create.isPending;

  const submit = async () => {
    if (!password || busy) return;
    const proof = await check();
    if (!proof) return;
    try {
      setToken((await create.mutateAsync({ id: user.id, reauth: proof })).token);
    } catch {
      showError(t("settings.users.linkError"));
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
        <PasswordField value={password} onChange={setPassword} error={error} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

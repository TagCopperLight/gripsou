import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "./ConfirmDialog";
import { ApiError } from "../api/client";
import { useDeleteAccount } from "../api/hooks";
import { throttleMinutes } from "../lib/mfa";

type DeleteAccountModalProps = {
  onClose: () => void;
  /** Called once the account has been deleted server-side. */
  onDeleted: () => void;
};

export function DeleteAccountModal({
  onClose,
  onDeleted,
}: DeleteAccountModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const remove = useDeleteAccount();

  const confirm = () => {
    if (password === "" || remove.isPending) return;
    remove.mutate(password, { onSuccess: onDeleted });
  };

  const minutes = throttleMinutes(remove.error);
  const error =
    minutes !== null
      ? t("auth.tooManyAttempts", { count: minutes })
      : remove.error instanceof ApiError && remove.error.status === 400
        ? t("twoFactor.wrongPassword")
        : t("settings.account.deleteAccountError");

  return (
    <ConfirmDialog
      title={t("settings.account.deleteAccountTitle")}
      body={t("settings.account.deleteAccountBody")}
      confirmLabel={
        remove.isPending
          ? t("settings.account.deleteAccountPending")
          : t("settings.account.deleteAccountConfirm")
      }
      busy={remove.isPending}
      confirmDisabled={password === ""}
      error={remove.isError ? error : null}
      onConfirm={confirm}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-sm text-fg-faint">
            {t("settings.account.deleteAccountConfirmLabel")}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-red"
          />
        </label>
        <button type="submit" hidden />
      </form>
    </ConfirmDialog>
  );
}

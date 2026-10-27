import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../lib/errorToasts";

import { ConfirmDialog } from "./ConfirmDialog";
import { PasswordField } from "./PasswordField";
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
  const wrongPassword = remove.error instanceof ApiError && remove.error.status === 400;
  const error =
    minutes !== null ? t("auth.tooManyAttempts", { count: minutes }) : wrongPassword ? t("twoFactor.wrongPassword") : null;
  useErrorToast(remove.isError && error === null && t("settings.account.deleteAccountError"));

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
        <PasswordField
          value={password}
          onChange={setPassword}
          label={t("settings.account.deleteAccountConfirmLabel")}
          danger
        />
        <button type="submit" hidden />
      </form>
    </ConfirmDialog>
  );
}

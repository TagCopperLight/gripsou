import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../../../lib/errorToasts";

import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { PasswordField } from "../../../ui/PasswordField";
import { useDeleteAccount } from "../../../api/auth";
import { passwordError } from "../../../auth/throttle";

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

  const error = passwordError(t, remove.error);
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
          onChange={(value) => {
            setPassword(value);
            remove.reset();
          }}
          label={t("settings.account.deleteAccountConfirmLabel")}
          danger
          error={error}
        />
        <button type="submit" hidden />
      </form>
    </ConfirmDialog>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../../../lib/errorToasts";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { useDeleteUser } from "../../../api/admin";
import type { User } from "../../../api/wire";
import { TextInput } from "../../../ui/TextInput";

type DeleteUserModalProps = {
  user: User;
  onClose: () => void;
  onDeleted: () => void;
};

export function DeleteUserModal({ user, onClose, onDeleted }: DeleteUserModalProps) {
  const { t } = useTranslation();
  const remove = useDeleteUser();
  const [email, setEmail] = useState("");
  const matches = email.trim().toLowerCase() === user.email.toLowerCase();

  useErrorToast(remove.isError && t("settings.users.removeUser.error"));

  return (
    // Large: a long name in the title, a long email to type back.
    <ConfirmDialog
      large
      title={t("settings.users.removeUser.title", { name: user.name })}
      body={t("settings.users.removeUser.body")}
      confirmLabel={remove.isPending ? t("settings.users.removeUser.deleting") : t("settings.users.deleteUser")}
      busy={remove.isPending}
      confirmDisabled={!matches}
      onConfirm={() => remove.mutate({ id: user.id, email: email.trim() }, { onSuccess: onDeleted })}
      onClose={onClose}
    >
      <p className="rounded-xl bg-red/10 px-4 py-3 text-sm text-red">
        {t("settings.users.removeUser.warning")}
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-fg-dim">
          {t("settings.users.removeUser.confirm", { email: user.email })}
        </span>
        <TextInput
          type="email"
          danger
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          placeholder={user.email}
          className="font-mono"
        />
      </label>
    </ConfirmDialog>
  );
}

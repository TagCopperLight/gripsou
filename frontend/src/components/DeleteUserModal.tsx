import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../lib/errorToasts";
import { ConfirmDialog } from "./ConfirmDialog";
import { useDeleteUser } from "../api/hooks";
import type { User } from "../api/types";

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
    <ConfirmDialog
      title={t("settings.users.removeUser.title", { name: user.name })}
      body={t("settings.users.removeUser.body")}
      confirmLabel={remove.isPending ? t("common.loading") : t("settings.users.deleteUser")}
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
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          placeholder={user.email}
          className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-fg font-mono outline-none focus:ring-2 focus:ring-red/40"
        />
      </label>
    </ConfirmDialog>
  );
}

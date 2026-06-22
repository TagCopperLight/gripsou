import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, TriangleAlert } from "lucide-react";
import { Button } from "./Button";
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const confirm = () => {
    if (!matches) return;
    remove.mutate({ id: user.id, email: email.trim() }, { onSuccess: onDeleted });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.users.removeUser.title", { name: user.name })}
        onClick={(e) => e.stopPropagation()}
        className="relative w-120 max-w-[90vw] bg-surface rounded-3xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2.5 text-xl font-semibold text-fg">
              <TriangleAlert className="size-5 text-red" />
              {t("settings.users.removeUser.title", { name: user.name })}
            </h2>
            <p className="text-sm text-fg-faint">{t("settings.users.removeUser.body")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="px-6 py-4 flex flex-col gap-4">
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
          {remove.isError && <p className="text-sm text-red">{t("settings.users.removeUser.error")}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={confirm}
            disabled={!matches || remove.isPending}
            aria-label={t("settings.users.deleteUser")}
          >
            {remove.isPending ? t("common.loading") : t("settings.users.deleteUser")}
          </Button>
        </div>
      </div>
    </div>
  );
}

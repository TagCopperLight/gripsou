import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, TriangleAlert } from "lucide-react";

import { Button } from "./Button";
import { useDeleteAccount } from "../api/hooks";

type DeleteAccountModalProps = {
  /** The signed-in user's email; the typed value must match it to confirm. */
  email: string;
  onClose: () => void;
  /** Called once the account has been deleted server-side. */
  onDeleted: () => void;
};

export function DeleteAccountModal({
  email,
  onClose,
  onDeleted,
}: DeleteAccountModalProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const remove = useDeleteAccount();

  // Close on Escape; lock background scroll while open.
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

  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();
  const canDelete = matches && !remove.isPending;

  const confirm = () => {
    if (!canDelete) return;
    remove.mutate(email, { onSuccess: onDeleted });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.account.deleteAccountTitle")}
        onClick={(e) => e.stopPropagation()}
        className="relative w-120 max-w-[90vw] bg-surface rounded-3xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="flex items-center gap-2.5 text-xl font-semibold text-fg">
            <TriangleAlert className="size-5 text-red" />
            {t("settings.account.deleteAccountTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 flex flex-col gap-5">
          <p className="text-sm text-fg-dim">{t("settings.account.deleteAccountBody")}</p>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg-faint">
              {t("settings.account.deleteAccountConfirmLabel", { email })}
            </span>
            <input
              type="email"
              aria-label={t("settings.account.deleteAccountConfirmLabel", { email })}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={email}
              autoComplete="off"
              className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-red"
            />
          </div>

          {remove.isError && (
            <p className="text-red text-sm">{t("settings.account.deleteAccountError")}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm} disabled={!canDelete}>
            {remove.isPending
              ? t("settings.account.deleteAccountPending")
              : t("settings.account.deleteAccountConfirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

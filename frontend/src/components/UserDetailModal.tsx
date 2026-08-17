import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Key, Trash2 } from "lucide-react";

import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { formatDate } from "../lib/date";
import type { User } from "../api/types";

type UserDetailModalProps = {
  user: User;
  /** Current role, including any unsaved local override from the users page. */
  role: "admin" | "user";
  onToggleRole: () => void;
  /** Both omitted for yourself — you can't reset or delete your own account here. */
  onReset?: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

// The phone list shows one summary row per user; email, join date and the
// per-user actions live here so those rows can stay a single line.
export function UserDetailModal({
  user,
  role,
  onToggleRole,
  onReset,
  onDelete,
  onClose,
}: UserDetailModalProps) {
  const { t } = useTranslation();

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

  const roleColor =
    role === "admin" ? "bg-green-soft text-green" : "bg-surface-3 text-fg-dim";
  const roleLabel = t(
    role === "admin" ? "settings.users.roleAdmin" : "settings.users.roleMember",
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={user.name}
        onClick={(e) => e.stopPropagation()}
        className="relative w-120 max-w-[90vw] bg-surface rounded-3xl flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={user.name} src={user.avatar} />
            <div className="flex min-w-0 flex-col">
              <h2 className="truncate text-lg font-semibold text-fg">{user.name}</h2>
              <span className="truncate text-sm text-fg-faint">{user.email}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="shrink-0 p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-6 py-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-fg-faint">{t("settings.users.columns.role")}</span>
            {/* Your own role is read-only here, as in the desktop table. */}
            {user.isSelf ? (
              <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${roleColor}`}>
                {roleLabel}
              </span>
            ) : (
              <button
                type="button"
                onClick={onToggleRole}
                className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors duration-140 ${roleColor} ${
                  role === "admin" ? "hover:bg-green/25" : "hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {roleLabel}
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-fg-faint">{t("settings.users.columns.joined")}</span>
            <span className="font-mono text-fg">{formatDate(user.joinedAt)}</span>
          </div>
        </div>

        {(onReset || onDelete) && (
          <div className="flex items-center justify-between gap-2 px-6 pb-6 pt-2">
            {onReset && (
              <Button variant="ghost" onClick={onReset} className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
                <Key className="size-4" />
                {t("settings.users.resetPassword")}
              </Button>
            )}
            {onDelete && (
              <Button variant="danger" onClick={onDelete} className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
                <Trash2 className="size-4" />
                {t("settings.users.deleteUser")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

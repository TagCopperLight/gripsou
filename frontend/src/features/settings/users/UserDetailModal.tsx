import { useTranslation } from "react-i18next";
import { Key, Trash2 } from "lucide-react";

import { Avatar } from "../../../ui/Avatar";
import { Button } from "../../../ui/Button";
import { Dialog } from "../../../ui/Dialog";
import { formatDate } from "../../../lib/date";
import type { Role, User } from "../../../api/wire";

type UserDetailModalProps = {
  user: User;
  role: Role;
  onToggleRole: () => void;
  roleSaving: boolean;
  onReset?: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

// The phone list shows one summary row per user; the rest lives here so rows stay one line.
export function UserDetailModal({
  user,
  role,
  onToggleRole,
  roleSaving,
  onReset,
  onDelete,
  onClose,
}: UserDetailModalProps) {
  const { t } = useTranslation();

  const roleColor =
    role === "admin" ? "bg-green-soft text-green" : "bg-surface-3 text-fg-dim";
  const roleLabel = t(
    role === "admin" ? "roles.admin" : "roles.member",
  );

  return (
    <Dialog
      title={user.name}
      icon={<Avatar name={user.name} src={user.avatar} />}
      heading={
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-lg">{user.name}</span>
          <span className="truncate text-sm font-normal text-fg-faint">{user.email}</span>
        </span>
      }
      onClose={onClose}
      footer={
        (onReset || onDelete) && (
          <div className="flex w-full items-center justify-between gap-2">
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
        )
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-fg-faint">{t("settings.users.columns.role")}</span>
          {user.isSelf ? (
            <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${roleColor}`}>
              {roleLabel}
            </span>
          ) : (
            <button
              type="button"
              onClick={onToggleRole}
              disabled={roleSaving}
              className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors duration-140 disabled:cursor-wait disabled:opacity-60 ${roleColor} ${
                role === "admin" ? "enabled:hover:bg-green/25" : "enabled:hover:bg-surface-2 enabled:hover:text-fg"
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
    </Dialog>
  );
}

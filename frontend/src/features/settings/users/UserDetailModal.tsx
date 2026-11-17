import { useTranslation } from "react-i18next";
import { Key, Trash2 } from "lucide-react";

import { Avatar } from "../../../ui/Avatar";
import { Button } from "../../../ui/Button";
import { Dialog } from "../../../ui/Dialog";
import { LoadingFrame } from "../../../ui/LoadingFrame";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { formatDate } from "../../../lib/date";
import type { Role, User } from "../../../api/wire";

type UserDetailModalProps = {
  user: User;
  role: Role;
  onSetRole: (role: Role) => void;
  roleSaving: boolean;
  onReset?: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

// The phone list shows one summary row per user; the rest lives here so rows stay one line.
export function UserDetailModal({
  user,
  role,
  onSetRole,
  roleSaving,
  onReset,
  onDelete,
  onClose,
}: UserDetailModalProps) {
  const { t } = useTranslation();


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
            <span className="text-fg">{t(role === "admin" ? "roles.admin" : "roles.member")}</span>
          ) : (
            <LoadingFrame loading={roleSaving}>
              <SegmentedControl<Role>
                value={role}
                onChange={(next) => next !== role && onSetRole(next)}
                options={[
                  { value: "user", label: t("roles.member") },
                  { value: "admin", label: t("roles.admin") },
                ]}
              />
            </LoadingFrame>
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

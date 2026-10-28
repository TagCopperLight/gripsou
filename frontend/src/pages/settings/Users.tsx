import { useState, type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Key, Trash2, ChevronRight } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { CardState } from "../../components/CardState";
import { useUsers, useCreateInvite, useSetUserRole } from "../../api/hooks";
import { useErrorToast } from "../../lib/errorToasts";
import { GridTable } from "../../components/GridTable";
import { HEAD_CELL, ROW_CELLS, ROW_HOVER } from "../../components/gridTable";
import { LinkModal } from "../../components/LinkModal";
import { ResetLinkModal } from "../../components/ResetLinkModal";
import { DeleteUserModal } from "../../components/DeleteUserModal";
import { UserDetailModal } from "../../components/UserDetailModal";
import { formatDate } from "../../lib/date";
import type { User } from "../../api/types";

type Role = "admin" | "user";
// Member, role, joined, then the actions (no title: a column of icons).
const TRACKS = "minmax(14rem, 1fr) minmax(6.5rem, auto) minmax(7rem, auto) minmax(5.5rem, auto)";
const MIN_WIDTH = "33rem";

export function SettingsUsers() {
  const { t } = useTranslation();
  const { data, isError, refetch } = useUsers();
  const ready = data !== undefined;
  const users = data ?? [];

  const invite = useCreateInvite();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [detail, setDetail] = useState<User | null>(null);

  const openInvite = () => {
    setInviteOpen(true);
    invite.mutate();
  };
  const linkFor = (path: string, token?: string) =>
    token ? `${window.location.origin}${path}/${token}` : null;

  // Saved on the server; the list refetches. Never on your own row (the
  // server refuses it too), and never the last admin.
  const setRole = useSetUserRole();
  const roleOf = (u: User): Role => u.role;
  const toggleRole = (u: User) => setRole.mutate({ id: u.id, role: u.role === "admin" ? "user" : "admin" });
  useErrorToast(setRole.isError && t("settings.users.roleError"));

  return (
    <div className="pb-8 md:mt-13">
      <Surface className="w-full">
        <div className="flex flex-col p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-fg font-semibold text-sm">{t("settings.users.title")}</h2>
            <Button onClick={openInvite} padded={false} className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-xs px-2.75 py-1.5 md:w-auto">
              <Plus className="size-4" />
              {t("settings.users.inviteUser")}
            </Button>
          </div>

          {!ready ? (
            <CardState
              variant={isError ? "error" : "loading"}
              onRetry={() => refetch()}
              className="mt-4 h-64"
            />
          ) : (
            <>
            {/* Phone: one summary row per user; the rest lives in a modal. */}
            <div className="mt-4 flex flex-col gap-2 md:hidden">
              {users.map((u) => {
                const role = roleOf(u);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setDetail(u)}
                    className="flex cursor-pointer items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-left"
                  >
                    <Avatar name={u.name} src={u.avatar} />
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate text-sm text-fg">{u.name}</span>
                      {u.isSelf && <YouTag />}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-medium ${
                        role === "admin" ? "bg-green-soft text-green" : "bg-surface-3 text-fg-dim"
                      }`}
                    >
                      {t(role === "admin" ? "roles.admin" : "roles.member")}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-fg-faint" />
                  </button>
                );
              })}
            </div>

            <div className="mt-4 hidden md:block">
              <GridTable
                columns={TRACKS}
                minWidth={MIN_WIDTH}
                head={
                  <>
                    <th role="columnheader" className={`${HEAD_CELL} px-3`}>{t("settings.users.columns.member")}</th>
                    <th role="columnheader" className={`${HEAD_CELL} px-3`}>{t("settings.users.columns.role")}</th>
                    <th role="columnheader" className={`${HEAD_CELL} px-3`}>{t("settings.users.columns.joined")}</th>
                    <th role="columnheader" className={`${HEAD_CELL} px-3`}><span className="sr-only">{t("settings.users.columns.actions")}</span></th>
                  </>
                }
              >
                {users.map((u) => {
                  const role = roleOf(u);
                  const label = t(role === "admin" ? "roles.admin" : "roles.member");
                  return (
                    <tr key={u.id} role="row" className={`${ROW_CELLS} ${ROW_HOVER}`}>
                      <td role="cell" className="gap-3 px-3 py-2.5">
                        <Avatar name={u.name} src={u.avatar} />
                        <div className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-2 text-sm leading-tight text-fg">
                            <span className="truncate">{u.name}</span>
                            {u.isSelf && <YouTag />}
                          </span>
                          <span className="truncate text-xs text-fg-faint">{u.email}</span>
                        </div>
                      </td>
                      <td role="cell" className="px-3">
                        {u.isSelf ? (
                          <RoleBadge role={role} label={label} />
                        ) : (
                          <RoleBadge
                            role={role}
                            label={label}
                            as="button"
                            title={t("settings.users.changeRole")}
                            disabled={setRole.isPending}
                            onClick={() => toggleRole(u)}
                          />
                        )}
                      </td>
                      <td role="cell" className="px-3 font-mono text-sm text-fg-dim">{formatDate(u.joinedAt)}</td>
                      <td role="cell" className="justify-end gap-0.5 px-3">
                        {/* Own password lives in the Account tab; here we only
                            offer to reset *other* users' passwords. */}
                        {!u.isSelf && (
                          <>
                            <IconButton onClick={() => setResetTarget(u)} aria-label={t("settings.users.resetPassword")}>
                              <Key className="size-4" />
                            </IconButton>
                            <IconButton danger onClick={() => setDeleteTarget(u)} aria-label={t("settings.users.deleteUser")}>
                              <Trash2 className="size-4" />
                            </IconButton>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </GridTable>
            </div>
            </>
          )}
        </div>
      </Surface>
      {detail && (
        <UserDetailModal
          user={detail}
          role={roleOf(detail)}
          onToggleRole={() => toggleRole(detail)}
          onReset={
            detail.isSelf
              ? undefined
              : () => {
                  const u = detail;
                  setDetail(null);
                  setResetTarget(u);
                }
          }
          onDelete={
            detail.isSelf
              ? undefined
              : () => {
                  const u = detail;
                  setDetail(null);
                  setDeleteTarget(u);
                }
          }
          onClose={() => setDetail(null)}
        />
      )}
      {inviteOpen && (
        <LinkModal
          title={t("settings.users.invite.title")}
          subtitle={t("settings.users.invite.heading")}
          body={t("settings.users.invite.body")}
          link={linkFor("/invite", invite.data?.token)}
          error={invite.isError}
          onClose={() => {
            setInviteOpen(false);
            invite.reset();
          }}
        />
      )}
      {resetTarget && (
        <ResetLinkModal user={resetTarget} onClose={() => setResetTarget(null)} />
      )}
      {deleteTarget && (
        <DeleteUserModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/** Marks your own row, like "This device" on the sessions list. */
function YouTag() {
  const { t } = useTranslation();
  return (
    <span className="shrink-0 rounded-md bg-green-soft px-2 py-0.5 text-xs font-medium text-green">
      {t("settings.users.you")}
    </span>
  );
}

/** A row's action, as on a connection row: the icon alone until hovered. */
function IconButton({ danger = false, ...props }: ComponentPropsWithoutRef<"button"> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={`flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-faint transition-colors duration-140 hover:bg-surface-2 ${
        danger ? "hover:text-red" : "hover:text-fg"
      }`}
      {...props}
    />
  );
}

function RoleBadge({
  role,
  label,
  as = "span",
  onClick,
  title,
  disabled,
}: {
  role: Role;
  label: string;
  as?: "span" | "button";
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
}) {
  const base = "inline-block rounded-md px-2.5 py-1 text-xs font-medium";
  const color = role === "admin" ? "bg-green-soft text-green" : "bg-surface-3 text-fg-dim";
  if (as === "button") {
    const hover = role === "admin" ? "hover:bg-green/25" : "hover:bg-surface-2 hover:text-fg";
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        disabled={disabled}
        className={`${base} ${color} ${hover} cursor-pointer transition-colors duration-140 disabled:cursor-wait disabled:opacity-60`}
      >
        {label}
      </button>
    );
  }
  return <span className={`${base} ${color}`}>{label}</span>;
}

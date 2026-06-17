import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Key, Trash2 } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { CardState } from "../../components/CardState";
import { useUsers } from "../../api/hooks";
import { formatDate } from "../../lib/date";
import type { User } from "../../api/types";

type Role = "admin" | "user";
const COLUMNS = ["member", "role", "joined", "actions"] as const;

export function SettingsUsers() {
  const { t } = useTranslation();
  const { data, isError, refetch } = useUsers();
  const ready = data !== undefined;
  const users = data ?? [];

  // Local optimistic role overrides; not persisted (no PATCH endpoint yet).
  const [overrides, setOverrides] = useState<Record<string, Role>>({});
  const roleOf = (u: User): Role => overrides[u.id] ?? u.role;
  const toggleRole = (u: User) =>
    setOverrides((prev) => ({
      ...prev,
      [u.id]: roleOf(u) === "admin" ? "user" : "admin",
    }));

  return (
    <div className="pb-8 mt-13">
      <Surface className="w-full">
        <div className="flex flex-col p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-fg font-semibold text-sm mb-auto">
              {t("settings.users")}
              {ready && (
                <span className="text-fg-faint font-normal ml-2">
                  <span className="mr-2">·</span>
                  {t("settings.usersCount", { count: users.length })}
                </span>
              )}
            </h2>
            <Button className="inline-flex items-center gap-1.5 text-sm">
              <Plus className="size-4" />
              {t("settings.addUser")}
            </Button>
          </div>

          {!ready ? (
            <CardState
              variant={isError ? "error" : "loading"}
              onRetry={() => refetch()}
              className="mt-4 h-64"
            />
          ) : (
            <table className="w-full mt-4 border-separate border-spacing-0">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c}
                      className={`pb-2 px-3 text-[11px] font-medium tracking-wide font-mono text-fg-faint ${
                        c === "actions" ? "text-right" : "text-left"
                      }`}
                    >
                      {t(`settings.columns.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const role = roleOf(u);
                  const label = t(role === "admin" ? "settings.roleAdmin" : "settings.roleMember");
                  return (
                    <tr key={u.id} className="hover:bg-hover transition-colors duration-140">
                      {/* MEMBER */}
                      <td className="py-3 px-3 border-t border-surface-2">
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} />
                          <div className="flex flex-col">
                            <span className="text-sm text-fg leading-tight flex items-center gap-2">
                              {u.name}
                              {u.isSelf && (
                                <span className="text-[10px] uppercase tracking-wide text-fg-dim border border-surface-3 rounded px-1.5 py-0.5">
                                  {t("settings.you")}
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-fg-faint">{u.email}</span>
                          </div>
                        </div>
                      </td>
                      {/* ROLE */}
                      <td className="py-3 px-3 border-t border-surface-2">
                        {u.isSelf ? (
                          <RoleBadge role={role} label={label} />
                        ) : (
                          <RoleBadge role={role} label={label} as="button" onClick={() => toggleRole(u)} />
                        )}
                      </td>
                      {/* JOINED */}
                      <td className="py-3 px-3 border-t border-surface-2 text-sm text-fg-dim font-mono">
                        {formatDate(u.joinedAt)}
                      </td>
                      {/* ACTIONS */}
                      <td className="py-3 px-3 border-t border-surface-2">
                        <div className="flex justify-end gap-1.5">
                          {/* Own password lives in the Account tab; here we only
                              offer to reset *other* users' passwords. */}
                          {!u.isSelf && (
                            <button
                              type="button"
                              aria-label={t("settings.resetPassword")}
                              className="size-8 rounded-lg bg-surface-2 text-fg-dim hover:text-fg flex items-center justify-center cursor-pointer transition-colors duration-140"
                            >
                              <Key className="size-4" />
                            </button>
                          )}
                          {!u.isSelf && (
                            <button
                              type="button"
                              aria-label={t("settings.deleteUser")}
                              className="size-8 rounded-lg bg-surface-2 text-fg-dim hover:text-red flex items-center justify-center cursor-pointer transition-colors duration-140"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Surface>
    </div>
  );
}

function RoleBadge({
  role,
  label,
  as = "span",
  onClick,
}: {
  role: Role;
  label: string;
  as?: "span" | "button";
  onClick?: () => void;
}) {
  const base = "inline-block rounded-md px-2.5 py-1 text-xs font-medium";
  const color = role === "admin" ? "bg-green-soft text-green" : "bg-surface-3 text-fg-dim";
  if (as === "button") {
    const hover = role === "admin" ? "hover:bg-green/25" : "hover:bg-surface-2 hover:text-fg";
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${color} ${hover} cursor-pointer transition-colors duration-140`}
      >
        {label}
      </button>
    );
  }
  return <span className={`${base} ${color}`}>{label}</span>;
}

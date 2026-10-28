import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Fingerprint, KeyRound, Loader2, Monitor, Plus, Settings, ShieldCheck, Smartphone } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { Toggle } from "../../components/Toggle";
import { CardState } from "../../components/CardState";
import { DeleteAccountModal } from "../../components/DeleteAccountModal";
import { SessionDetailModal } from "../../components/SessionDetailModal";
import { EditProfileModal } from "../../components/EditProfileModal";
import { ChangePasswordModal } from "../../components/ChangePasswordModal";
import { TotpSetupModal } from "../../components/TotpSetupModal";
import { ManageTwoFactorModal } from "../../components/ManageTwoFactorModal";
import { PasskeysModal } from "../../components/PasskeysModal";
import { AddPasskeyModal } from "../../components/AddPasskeyModal";
import {
  useMfaStatus,
  useSessions,
  useRevokeSession,
  useRevokeOtherSessions,
} from "../../api/hooks";
import { useAuth } from "../../auth/context";
import type { Session } from "../../api/types";
import { formatDate, formatRelative } from "../../lib/date";

export function SettingsAccount() {
  const { t } = useTranslation();
  const { user, logout, prefs } = useAuth();
  const mfa = useMfaStatus();
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [managing, setManaging] = useState<"menu" | "turnOff" | null>(null);
  const [passkeysOpen, setPasskeysOpen] = useState(false);
  const hasPasskeys = (mfa.data?.passkeys.length ?? 0) > 0;
  const [addingPasskey, setAddingPasskey] = useState(false);
  const addPasskey = () => {
    setPasskeysOpen(false);
    setAddingPasskey(true);
  };
  // The password window closes on success; the row says it worked.
  const [passwordChanged, setPasswordChanged] = useState(false);

  const sessionsQuery = useSessions();
  const sessions = sessionsQuery.data ?? [];
  const revokeSession = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const hasOthers = sessions.some((s) => !s.current);

  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [detail, setDetail] = useState<Session | null>(null);
  const onDeleted = async () => {
    setDeleteOpen(false);
    await logout();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex flex-col gap-4 pb-8 md:mt-13">
      <Surface className="flex items-center gap-4 p-6">
        <Avatar name={user?.name ?? "?"} src={prefs.avatar} className="size-14" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-lg font-semibold text-fg">{user?.name}</span>
          <span className="truncate text-sm text-fg-faint">{user?.email}</span>
        </div>
        <Button variant="ghostStrong" onClick={() => setEditing(true)}>
          {t("settings.account.editProfile")}
        </Button>
      </Surface>

      <Surface className="p-6">
        <h2 className="mb-5 text-lg font-semibold text-fg">{t("settings.account.security")}</h2>
        <div className="flex flex-col gap-3">
          <SecurityRow
            icon={<KeyRound className="size-4.5" strokeWidth={2} />}
            title={t("settings.account.password")}
            hint={
              passwordChanged && (
                <span className="text-green">{t("settings.account.passwordUpdated")}</span>
              )
            }
            action={
              <Button
                variant="ghostStrong"
                onClick={() => {
                  setPasswordChanged(false);
                  setChangingPassword(true);
                }}
              >
                {t("settings.account.changePassword")}
              </Button>
            }
          />
          <SecurityRow
            icon={
              mfa.data?.totp ? (
                <ShieldCheck className="size-4.5" strokeWidth={2} />
              ) : (
                <Smartphone className="size-4.5" strokeWidth={2} />
              )
            }
            iconTone={mfa.data?.totp ? "bg-green-soft text-green" : undefined}
            title={t("settings.account.twoFactor")}
            hint={mfa.isError && <span className="text-red">{t("common.loadFailed")}</span>}
            action={
              !mfa.data ? (
                <MfaPending failed={mfa.isError} onRetry={() => mfa.refetch()} />
              ) : (
                <div className="flex items-center gap-3">
                  {mfa.data.totp && (
                    <button
                      type="button"
                      onClick={() => setManaging("menu")}
                      aria-label={t("settings.account.manage")}
                      className="cursor-pointer rounded-lg p-1.5 text-fg-dim transition-colors duration-140 hover:bg-surface-3 hover:text-fg"
                    >
                      <Settings className="size-4.5" strokeWidth={2} />
                    </button>
                  )}
                  <Toggle
                    checked={mfa.data.totp}
                    onChange={(on) => (on ? setSettingUp(true) : setManaging("turnOff"))}
                    aria-label={t("settings.account.twoFactor")}
                    offClassName="bg-surface-3"
                  />
                </div>
              )
            }
          />
          <SecurityRow
            icon={<Fingerprint className="size-4.5" strokeWidth={2} />}
            iconTone={hasPasskeys ? "bg-green-soft text-green" : undefined}
            title={t("passkeys.title")}
            hint={mfa.isError && <span className="text-red">{t("common.loadFailed")}</span>}
            action={
              !mfa.data ? (
                <MfaPending failed={mfa.isError} onRetry={() => mfa.refetch()} />
              ) : (
                <div className="flex items-center gap-3">
                  {hasPasskeys && (
                    <button
                      type="button"
                      onClick={() => setPasskeysOpen(true)}
                      aria-label={t("settings.account.manage")}
                      className="cursor-pointer rounded-lg p-1.5 text-fg-dim transition-colors duration-140 hover:bg-surface-3 hover:text-fg"
                    >
                      <Settings className="size-4.5" strokeWidth={2} />
                    </button>
                  )}
                  {/* As wide as the two-factor switch above, so the gears line up. */}
                  <button
                    type="button"
                    onClick={addPasskey}
                    aria-label={t("passkeys.addPasskey")}
                    className="flex h-7.5 w-11 cursor-pointer items-center justify-center rounded-lg text-fg-dim transition-colors duration-140 hover:bg-surface-3 hover:text-fg"
                  >
                    <Plus className="size-5" strokeWidth={2} />
                  </button>
                </div>
              )
            }
          />
        </div>
      </Surface>

      <Surface className="p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-fg">{t("settings.account.sessions")}</h2>
          {hasOthers && (
            <Button
              variant="ghost"
              onClick={() => revokeOthers.mutate()}
              disabled={revokeOthers.isPending}
              className="-my-2 text-red hover:bg-red/12 hover:text-red"
            >
              {t("settings.account.logOutOtherSessions")}
            </Button>
          )}
        </div>
        {/* Not an empty list while it loads or when it can't: there is always
            at least this session. */}
        {!sessionsQuery.data && (
          <CardState
            variant={sessionsQuery.isError ? "error" : "loading"}
            onRetry={() => sessionsQuery.refetch()}
            className="h-32"
          />
        )}
        {/* Phone: one fixed-height summary row per session, details on tap. */}
        <div className="flex flex-col gap-3 md:hidden">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setDetail(s)}
              className="flex cursor-pointer items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-left"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] text-fg">{s.device}</span>
                  {s.current && (
                    <span className="shrink-0 rounded-md bg-green-soft px-2 py-0.5 text-xs font-medium text-green">
                      {t("settings.account.thisDevice")}
                    </span>
                  )}
                </span>
                <span className="truncate text-sm text-fg-faint">
                  {s.ip ? `${s.ip} · ` : ""}
                  {t("settings.account.lastActive", { time: formatRelative(s.lastActiveAt) })}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-fg-faint" />
            </button>
          ))}
        </div>

        {/* Computer: one card, a line between sessions, this device first then
            the most recently active, "Log out" on hover — as in the passkeys
            window. */}
        {sessionsQuery.data && (
          <div className="hidden overflow-hidden rounded-2xl bg-surface-2 md:block">
            {[...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt).map((s) => (
              <div key={s.id} className="group flex items-center gap-3.5 border-t border-surface-3 px-3.5 py-3 first:border-t-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-dim">
                  {isPhone(s.device) ? <Smartphone className="size-4.5" strokeWidth={2} /> : <Monitor className="size-4.5" strokeWidth={2} />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[15px] text-fg">{s.device}</span>
                    {s.current && (
                      <span className="shrink-0 rounded-md bg-green-soft px-2 py-0.5 text-xs font-medium text-green">
                        {t("settings.account.thisDevice")}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-sm text-fg-faint">
                    {s.current
                      ? t("settings.account.activeNow")
                      : t("settings.account.lastActive", { time: formatRelative(s.lastActiveAt) })}
                    {s.ip && (
                      <>
                        {" · "}
                        <span className="font-mono text-xs">{s.ip}</span>
                      </>
                    )}
                    {" · "}
                    {t("settings.account.signedInOn", { date: formatDate(s.createdAt) })}
                  </span>
                </div>
                {!s.current && (
                  <Button
                    variant="ghost"
                    onClick={() => revokeSession.mutate(s.id)}
                    disabled={revokeSession.isPending}
                    className="shrink-0 text-red opacity-0 transition-opacity duration-140 hover:bg-red/12 hover:text-red focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    {t("settings.account.revokeSession")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Surface>

      <Surface className="p-6 ring-1 ring-inset ring-red/30">
        <h2 className="mb-1 text-lg font-semibold text-red">
          {t("settings.account.dangerZone")}
        </h2>
        <p className="mb-5 text-sm text-fg-faint">
          {t("settings.account.deleteAccountDescription")}
        </p>
        <div className="flex justify-end">
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            {t("settings.account.deleteAccount")}
          </Button>
        </div>
      </Surface>

      {detail && (
        <SessionDetailModal
          session={detail}
          revoking={revokeSession.isPending}
          onRevoke={
            detail.current
              ? undefined
              : () => {
                  revokeSession.mutate(detail.id);
                  setDetail(null);
                }
          }
          onClose={() => setDetail(null)}
        />
      )}

      {editing && <EditProfileModal onClose={() => setEditing(false)} />}
      {changingPassword && (
        <ChangePasswordModal
          onClose={() => setChangingPassword(false)}
          onChanged={() => setPasswordChanged(true)}
        />
      )}

      {settingUp && <TotpSetupModal onClose={() => setSettingUp(false)} />}
      {managing && <ManageTwoFactorModal start={managing} onClose={() => setManaging(null)} />}
      {addingPasskey && <AddPasskeyModal onClose={() => setAddingPasskey(false)} />}
      {passkeysOpen && (
        <PasskeysModal onClose={() => setPasskeysOpen(false)} onAdd={addPasskey} />
      )}

      {deleteOpen && (
        <DeleteAccountModal
          onClose={() => setDeleteOpen(false)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

/** A phone or tablet, from the device name the server writes ("Safari on iPhone"). */
function isPhone(device: string): boolean {
  return /iPhone|iPad|Android|Mobile/i.test(device);
}

/** A security row's control while two-factor's status loads, or a retry
 *  once it failed (the row's hint says so). */
function MfaPending({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  if (!failed) return <Loader2 aria-label={t("common.loading")} className="size-4.5 animate-spin text-fg-faint" />;
  return (
    <Button variant="ghostStrong" onClick={onRetry}>
      {t("common.retry")}
    </Button>
  );
}

function SecurityRow({
  icon,
  iconTone = "bg-surface-3 text-fg-dim",
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  iconTone?: string;
  title: string;
  hint?: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-140 ${iconTone}`}>
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] text-fg">{title}</span>
        </span>
        {hint && <span className="text-sm text-fg-faint">{hint}</span>}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

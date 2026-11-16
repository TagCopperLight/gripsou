import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, KeyRound, Monitor, Plus, Settings, Smartphone } from "lucide-react";
import { boneWidths } from "../../../ui/boneWidths";

import { Surface } from "../../../ui/Surface";
import { SettingsSurface } from "../../../ui/SettingsSurface";
import { Button } from "../../../ui/Button";
import { Avatar } from "../../../ui/Avatar";
import { Toggle } from "../../../ui/Toggle";
import { CardError } from "../../../ui/CardError";
import { Tag } from "../../../ui/Tag";
import { LoadingFrame } from "../../../ui/LoadingFrame";
import { Bone, Skeleton, TextBone } from "../../../ui/Skeleton";
import { DeleteAccountModal } from "./DeleteAccountModal";
import { SessionDetailModal } from "../security/SessionDetailModal";
import { EditProfileModal } from "./EditProfileModal";
import { ChangePasswordModal } from "../security/ChangePasswordModal";
import { TotpSetupModal } from "../security/TotpSetupModal";
import { ManageTwoFactorModal } from "../security/ManageTwoFactorModal";
import { PasskeysModal } from "../security/PasskeysModal";
import { AddPasskeyModal } from "../security/AddPasskeyModal";
import { PasskeyRow, SecurityRow, TotpRow } from "../security/SecurityRow";
import { useMfaStatus, useSessions, useRevokeSession, useRevokeOtherSessions } from "../../../api/auth";
import { useAuth } from "../../../auth/context";
import type { Session } from "../../../api/wire";
import { formatDate, formatRelative } from "../../../lib/date";

export function SettingsAccount() {
  const { t } = useTranslation();
  const { user, logout, prefs } = useAuth();
  const mfa = useMfaStatus();
  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [managing, setManaging] = useState<"menu" | "turnOff" | null>(null);
  const [passkeysOpen, setPasskeysOpen] = useState(false);
  const totp = mfa.data?.totp ?? false;
  const hasPasskeys = (mfa.data?.passkeys.length ?? 0) > 0;
  const [addingPasskey, setAddingPasskey] = useState(false);
  const addPasskey = () => {
    setPasskeysOpen(false);
    setAddingPasskey(true);
  };
  const [passwordChanged, setPasswordChanged] = useState(false);

  const sessionsQuery = useSessions();
  const sessions = sessionsQuery.data ?? [];
  const revokeSession = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const hasOthers = sessions.some((s) => !s.current);

  const passkeyAction = (
    <div className="flex items-center gap-3">
      {hasPasskeys && (
        <button
          type="button"
          onClick={() => setPasskeysOpen(true)}
          aria-label={t("settings.account.manage")}
          className={ICON_BUTTON}
        >
          <Settings className="size-4.5" strokeWidth={2} />
        </button>
      )}
      <button
        type="button"
        onClick={addPasskey}
        aria-label={t("passkeys.addPasskey")}
        className="flex h-7.5 w-11 cursor-pointer items-center justify-center rounded-lg text-fg-dim transition-colors duration-140 enabled:hover:bg-surface-3 enabled:hover:text-fg"
      >
        <Plus className="size-5" strokeWidth={2} />
      </button>
    </div>
  );

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

      <SettingsSurface title={t("settings.account.security")}>
        <LoadingFrame loading={mfa.isPending} className="flex flex-col gap-3">
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
          <TotpRow
            action={
              <div className="flex items-center gap-3">
                {totp && (
                  <button
                    type="button"
                    onClick={() => setManaging("menu")}
                    aria-label={t("settings.account.manage")}
                    className={ICON_BUTTON}
                  >
                    <Settings className="size-4.5" strokeWidth={2} />
                  </button>
                )}
                <Toggle
                  checked={totp}
                  onChange={(on) => (on ? setSettingUp(true) : setManaging("turnOff"))}
                  aria-label={t("settings.account.twoFactor")}
                  offClassName="bg-surface-3"
                />
              </div>
            }
            pending={
              <Skeleton>
                <Bone className="h-6 w-11 rounded-full" />
              </Skeleton>
            }
          />
          <PasskeyRow
            action={passkeyAction}
            pending={passkeyAction}
          />
        </LoadingFrame>
      </SettingsSurface>

      <SettingsSurface
        title={t("settings.account.sessions")}
        action={hasOthers && (
          <Button
            variant="ghost"
            onClick={() => revokeOthers.mutate()}
            busy={revokeOthers.isPending}
            busyLabel={t("common.busy.loggingOut")}
            className="-my-2 text-red enabled:hover:bg-red/12 enabled:hover:text-red"
          >
            {t("settings.account.logOutOtherSessions")}
          </Button>
        )}
      >
        {/* There is always at least this session. */}
        {sessionsQuery.isPending && <SessionsSkeleton />}
        {sessionsQuery.isError && (
          <CardError onRetry={() => sessionsQuery.refetch()} className="h-32" />
        )}
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
                    <Tag tone="green">
                      {t("settings.account.thisDevice")}
                    </Tag>
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
                      <Tag tone="green">
                        {t("settings.account.thisDevice")}
                      </Tag>
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
                    busy={revokeSession.isPending && revokeSession.variables === s.id}
                    busyLabel={t("common.busy.loggingOut")}
                    className="shrink-0 text-red opacity-0 transition-opacity duration-140 enabled:hover:bg-red/12 enabled:hover:text-red focus-visible:opacity-100 group-hover:opacity-100 aria-busy:opacity-100"
                  >
                    {t("settings.account.revokeSession")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsSurface>

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

const ICON_BUTTON =
  "cursor-pointer rounded-lg p-1.5 text-fg-dim transition-colors duration-140 enabled:hover:bg-surface-3 enabled:hover:text-fg";

function SessionsSkeleton() {
  const rows = boneWidths(2);
  return (
    <Skeleton>
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((w) => (
          <div key={w} className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <TextBone text="text-[15px]" style={{ width: `${w}%` }} />
              <TextBone text="text-sm" style={{ width: `${w + 20}%` }} />
            </span>
          </div>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-2xl bg-surface-2 md:block">
        {rows.map((w) => (
          <div key={w} className="flex items-center gap-3.5 border-t border-surface-3 px-3.5 py-3 first:border-t-0">
            <Bone className="size-9 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <TextBone text="text-[15px]" style={{ width: `${w * 0.6}%` }} />
              <TextBone text="text-sm" style={{ width: `${w}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Skeleton>
  );
}

function isPhone(device: string): boolean {
  return /iPhone|iPad|Android|Mobile/i.test(device);
}

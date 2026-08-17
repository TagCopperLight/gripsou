import { useState, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { DeleteAccountModal } from "../../components/DeleteAccountModal";
import { SessionDetailModal } from "../../components/SessionDetailModal";
import {
  useChangePassword,
  useUpdateProfile,
  useSessions,
  useRevokeSession,
  useRevokeOtherSessions,
} from "../../api/hooks";
import { useAuth } from "../../auth/context";
import type { Session } from "../../api/types";
import { formatDate, formatRelative } from "../../lib/date";
import { fileToAvatarDataUrl } from "../../lib/avatar";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function SettingsAccount() {
  const { t } = useTranslation();
  const { user, logout, updateUser, prefs, updatePrefs } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    const avatar = await fileToAvatarDataUrl(file);
    void updatePrefs({ ...prefs, avatar });
  };

  const removeAvatar = () => void updatePrefs({ ...prefs, avatar: undefined });

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const updateProfile = useUpdateProfile();

  const profileDirty = name !== (user?.name ?? "") || email !== (user?.email ?? "");
  const profileValid = name.trim() !== "" && EMAIL_RE.test(email);
  const canSaveProfile = profileDirty && profileValid && !updateProfile.isPending;
  // The handler returns 409 when the new email collides with another account.
  const emailTaken = updateProfile.error?.message.includes(" 409") ?? false;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const changePassword = useChangePassword();

  const passwordsMismatch =
    confirmPassword !== "" && newPassword !== confirmPassword;
  const canUpdatePassword =
    currentPassword !== "" &&
    newPassword !== "" &&
    newPassword === confirmPassword;

  const saveProfile = () => {
    if (!canSaveProfile) return;
    updateProfile.mutate(
      { name: name.trim(), email: email.trim() },
      {
        onSuccess: (updated) => {
          // Reflect the edit everywhere the cached profile is read (sidebar
          // avatar, delete-account confirmation, admin user list).
          updateUser(updated);
          setName(updated.name);
          setEmail(updated.email);
        },
      },
    );
  };

  const updatePassword = () => {
    if (!canUpdatePassword) return;
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
      },
    );
  };

  const { data: sessions = [] } = useSessions();
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-stretch">
      <Surface className="p-6 h-full flex flex-col">
        <h2 className="mb-5 text-lg font-semibold text-fg">
          {t("settings.account.profile")}
        </h2>
        <div className="mb-6.25 flex items-center gap-4">
          <Avatar name={name || (user?.name ?? "?")} src={prefs.avatar} className="size-16" />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              {t("settings.account.uploadImage")}
            </Button>
            {prefs.avatar && (
              <Button variant="ghost" onClick={removeAvatar} className="text-red hover:text-red">
                {t("settings.account.removeImage")}
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label={t("settings.account.uploadImage")}
            onChange={onPickAvatar}
          />
        </div>
        <div className="flex flex-1 flex-col gap-5">
          <Field label={t("settings.account.name")}>
            <TextInput value={name} onChange={setName} ariaLabel={t("settings.account.name")} />
          </Field>
          <Field label={t("settings.account.email")}>
            <TextInput
              type="email"
              value={email}
              onChange={setEmail}
              ariaLabel={t("settings.account.email")}
            />
          </Field>
          {updateProfile.isSuccess && (
            <p className="text-sm text-green">{t("settings.account.profileUpdated")}</p>
          )}
          {updateProfile.isError && (
            <p className="text-sm text-red">
              {emailTaken
                ? t("settings.account.emailInUse")
                : t("settings.account.profileUpdateFailed")}
            </p>
          )}
          <div className="mt-auto flex justify-end pt-1">
            <Button onClick={saveProfile} disabled={!canSaveProfile}>
              {t("settings.account.saveChanges")}
            </Button>
          </div>
        </div>
      </Surface>

      <Surface className="p-6 h-full flex flex-col">
        <h2 className="mb-5 text-lg font-semibold text-fg">
          {t("settings.account.password")}
        </h2>
        <div className="flex flex-1 flex-col gap-5">
          <Field label={t("settings.account.currentPassword")}>
            <TextInput
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              ariaLabel={t("settings.account.currentPassword")}
            />
          </Field>
          <Field label={t("settings.account.newPassword")}>
            <TextInput
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              ariaLabel={t("settings.account.newPassword")}
            />
          </Field>
          <Field label={t("settings.account.confirmNewPassword")}>
            <TextInput
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              ariaLabel={t("settings.account.confirmNewPassword")}
            />
          </Field>
          {passwordsMismatch && (
            <p className="text-sm text-red">{t("settings.account.passwordsDoNotMatch")}</p>
          )}
          {changePassword.isSuccess && (
            <p className="text-sm text-green">{t("settings.account.passwordUpdated")}</p>
          )}
          {changePassword.isError && (
            <p className="text-sm text-red">
              {t("settings.account.currentPasswordIncorrect")}
            </p>
          )}
          <div className="mt-auto flex justify-end pt-1">
            <Button
              onClick={updatePassword}
              disabled={!canUpdatePassword || changePassword.isPending}
            >
              {t("settings.account.updatePassword")}
            </Button>
          </div>
        </div>
      </Surface>
      </div>

      <Surface className="p-6">
        <h2 className="mb-1 text-lg font-semibold text-fg">{t("settings.account.sessions")}</h2>
        <p className="mb-5 text-sm text-fg-faint">{t("settings.account.sessionsDescription")}</p>
        {/* Phone: one fixed-height summary row per session, details on tap. */}
        <div className="flex flex-col gap-3 md:hidden">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setDetail(s)}
              className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-left"
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

        <div className="hidden flex-col gap-3 md:flex">
          {sessions.map((s) => (
            <div key={s.id} className="flex flex-col gap-2 rounded-xl bg-surface-2 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] text-fg">{s.device}</span>
                  {s.current && (
                    <span className="rounded-md bg-green-soft px-2 py-0.5 text-xs font-medium text-green">
                      {t("settings.account.thisDevice")}
                    </span>
                  )}
                  <span className="rounded-md bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-dim">
                    {s.remembered
                      ? t("settings.account.sessionRemembered")
                      : t("settings.account.sessionSingle")}
                  </span>
                </div>
                <span className="text-sm text-fg-faint">
                  {s.ip ? `${s.ip} · ` : ""}
                  {t("settings.account.lastActive", { time: formatRelative(s.lastActiveAt) })}
                  {" · "}
                  {t("settings.account.signedInOn", { date: formatDate(s.createdAt) })}
                </span>
              </div>
              {!s.current && (
                <Button
                  variant="ghost"
                  onClick={() => revokeSession.mutate(s.id)}
                  disabled={revokeSession.isPending}
                  className="self-end shrink-0 text-red hover:text-red"
                >
                  {t("settings.account.revokeSession")}
                </Button>
              )}
            </div>
          ))}
        </div>
        {hasOthers && (
          <div className="flex justify-end pt-4">
            <Button
              variant="ghost"
              onClick={() => revokeOthers.mutate()}
              disabled={revokeOthers.isPending}
              className="text-red hover:text-red"
            >
              {t("settings.account.logOutOtherSessions")}
            </Button>
          </div>
        )}
      </Surface>

      <Surface className="p-6 ring-1 ring-red/30">
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

      {deleteOpen && (
        <DeleteAccountModal
          email={user?.email ?? ""}
          onClose={() => setDeleteOpen(false)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-fg-faint">{label}</span>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  type = "text",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  ariaLabel?: string;
}) {
  return (
    <input
      type={type}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green h-10.25"
    />
  );
}

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { DeleteAccountModal } from "../../components/DeleteAccountModal";
import { useChangePassword, useSessions, useRevokeSession, useRevokeOtherSessions } from "../../api/hooks";
import { useAuth } from "../../auth/context";
import { formatDate, formatRelative } from "../../lib/date";

// Seeded locally until a profile API lands; fields don't persist yet.
const INITIAL_PROFILE = {
  name: "Julien BOURDET",
  email: "julien.bourdet@example.com",
};

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function SettingsAccount() {
  const { t } = useTranslation();

  const [name, setName] = useState(INITIAL_PROFILE.name);
  const [email, setEmail] = useState(INITIAL_PROFILE.email);

  const profileDirty =
    name !== INITIAL_PROFILE.name || email !== INITIAL_PROFILE.email;
  const profileValid = name.trim() !== "" && EMAIL_RE.test(email);
  const canSaveProfile = profileDirty && profileValid;

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
    // TODO: wire to the profile update API once it lands.
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

  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const onDeleted = async () => {
    setDeleteOpen(false);
    await logout();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <h1 className="text-2xl font-bold">{t("settings.account")}</h1>

      <Surface className="p-6">
        <h2 className="mb-5 text-lg font-semibold text-fg">
          {t("settings.profile")}
        </h2>
        <div className="flex flex-col gap-5">
          <Field label={t("settings.name")}>
            <TextInput value={name} onChange={setName} />
          </Field>
          <Field label={t("settings.email")}>
            <TextInput type="email" value={email} onChange={setEmail} />
          </Field>
          <div className="flex justify-end pt-1">
            <Button onClick={saveProfile} disabled={!canSaveProfile}>
              {t("settings.saveChanges")}
            </Button>
          </div>
        </div>
      </Surface>

      <Surface className="p-6">
        <h2 className="mb-5 text-lg font-semibold text-fg">
          {t("settings.password")}
        </h2>
        <div className="flex flex-col gap-5">
          <Field label={t("settings.currentPassword")}>
            <TextInput
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              ariaLabel={t("settings.currentPassword")}
            />
          </Field>
          <Field label={t("settings.newPassword")}>
            <TextInput
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              ariaLabel={t("settings.newPassword")}
            />
          </Field>
          <Field label={t("settings.confirmNewPassword")}>
            <TextInput
              type="password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              ariaLabel={t("settings.confirmNewPassword")}
            />
          </Field>
          {passwordsMismatch && (
            <p className="text-sm text-red">{t("settings.passwordsDoNotMatch")}</p>
          )}
          {changePassword.isSuccess && (
            <p className="text-sm text-green">{t("settings.passwordUpdated")}</p>
          )}
          {changePassword.isError && (
            <p className="text-sm text-red">
              {t("settings.currentPasswordIncorrect")}
            </p>
          )}
          <div className="flex justify-end pt-1">
            <Button
              onClick={updatePassword}
              disabled={!canUpdatePassword || changePassword.isPending}
            >
              {t("settings.updatePassword")}
            </Button>
          </div>
        </div>
      </Surface>

      <Surface className="p-6">
        <h2 className="mb-1 text-lg font-semibold text-fg">{t("settings.sessions")}</h2>
        <p className="mb-5 text-sm text-fg-faint">{t("settings.sessionsDescription")}</p>
        <div className="flex flex-col gap-3">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] text-fg">{s.device}</span>
                  {s.current && (
                    <span className="rounded-md bg-green-soft px-2 py-0.5 text-xs font-medium text-green">
                      {t("settings.thisDevice")}
                    </span>
                  )}
                  <span className="rounded-md bg-surface-3 px-2 py-0.5 text-xs font-medium text-fg-dim">
                    {s.remembered
                      ? t("settings.sessionRemembered")
                      : t("settings.sessionSingle")}
                  </span>
                </div>
                <span className="text-sm text-fg-faint">
                  {s.ip ? `${s.ip} · ` : ""}
                  {t("settings.lastActive", { time: formatRelative(s.lastActiveAt) })}
                  {" · "}
                  {t("settings.signedInOn", { date: formatDate(s.createdAt) })}
                </span>
              </div>
              {!s.current && (
                <Button
                  variant="ghost"
                  onClick={() => revokeSession.mutate(s.id)}
                  disabled={revokeSession.isPending}
                  className="text-red hover:text-red"
                >
                  {t("settings.revokeSession")}
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
              {t("settings.logOutOtherSessions")}
            </Button>
          </div>
        )}
      </Surface>

      <Surface className="p-6 ring-1 ring-red/30">
        <h2 className="mb-1 text-lg font-semibold text-red">
          {t("settings.dangerZone")}
        </h2>
        <p className="mb-5 text-sm text-fg-faint">
          {t("settings.deleteAccountDescription")}
        </p>
        <div className="flex justify-end">
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            {t("settings.deleteAccount")}
          </Button>
        </div>
      </Surface>

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
      className="w-full bg-surface-2 rounded-xl px-4 py-3 text-fg text-[15px] outline-none focus:ring-1 focus:ring-green"
    />
  );
}

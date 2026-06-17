import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { useChangePassword } from "../../api/hooks";

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

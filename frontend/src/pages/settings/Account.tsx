import { useState, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";

import { Surface } from "../../components/Surface";
import { Button } from "../../components/Button";
import { Avatar } from "../../components/Avatar";
import { DeleteAccountModal } from "../../components/DeleteAccountModal";
import { useUpdateProfile } from "../../api/hooks";
import { useAuth } from "../../auth/context";
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

  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
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

      <Surface className="p-6 ring-1 ring-red/30 h-full">
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
      </div>

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

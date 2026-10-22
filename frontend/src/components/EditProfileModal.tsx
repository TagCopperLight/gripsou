import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { Avatar } from "./Avatar";
import { useUpdateProfile } from "../api/hooks";
import { useAuth } from "../auth/context";
import { fileToAvatarDataUrl } from "../lib/avatar";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** Picture, name and email. The picture is saved as soon as it is picked;
 *  name and email on Save. */
export function EditProfileModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user, updateUser, prefs, updatePrefs } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const updateProfile = useUpdateProfile();

  const onPickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    const avatar = await fileToAvatarDataUrl(file);
    void updatePrefs({ ...prefs, avatar });
  };

  const dirty = name !== (user?.name ?? "") || email !== (user?.email ?? "");
  const valid = name.trim() !== "" && EMAIL_RE.test(email);
  const canSave = dirty && valid && !updateProfile.isPending;
  // The handler returns 409 when the new email collides with another account.
  const emailTaken = updateProfile.error?.message.includes(" 409") ?? false;

  const save = () => {
    if (!canSave) return;
    updateProfile.mutate(
      { name: name.trim(), email: email.trim() },
      {
        onSuccess: (updated) => {
          // Reflect the edit everywhere the cached profile is read (sidebar
          // avatar, delete-account confirmation, admin user list).
          updateUser(updated);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      title={t("settings.account.editProfile")}
      onClose={onClose}
      busy={updateProfile.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={!canSave}>{t("settings.account.saveChanges")}</Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-2 pb-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={t("settings.account.changePicture")}
              className="group relative cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-green"
            >
              <Avatar
                name={name || (user?.name ?? "?")}
                src={prefs.avatar}
                className="size-24 transition-opacity duration-140 group-hover:opacity-40"
                initialsClassName="text-2xl"
              />
              <Pencil
                className="absolute inset-0 m-auto size-5 text-fg opacity-0 transition-opacity duration-140 group-hover:opacity-100"
                strokeWidth={2}
              />
            </button>
            {prefs.avatar && (
              <button
                type="button"
                onClick={() => void updatePrefs({ ...prefs, avatar: undefined })}
                className="cursor-pointer text-xs font-medium text-red hover:opacity-70"
              >
                {t("settings.account.removeImage")}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label={t("settings.account.changePicture")}
              onChange={onPickAvatar}
            />
          </div>
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-2">
              <span className="text-sm text-fg-faint">{t("settings.account.name")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-10.25 w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm text-fg-faint">{t("settings.account.email")}</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10.25 w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green"
              />
            </label>
          </div>
        </div>
        {updateProfile.isError && (
          <p className="text-sm text-red">
            {emailTaken ? t("settings.account.emailInUse") : t("settings.account.profileUpdateFailed")}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

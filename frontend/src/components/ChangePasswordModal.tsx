import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { useChangePassword } from "../api/hooks";
import { passwordLengthOk } from "../lib/password";

export function ChangePasswordModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [next, setNextValue] = useState("");
  const [confirm, setConfirm] = useState("");
  // Set when Update is clicked with a new password breaking the length rule;
  // editing the new password clears it.
  const [lengthError, setLengthError] = useState(false);
  const setNext = (v: string) => {
    setNextValue(v);
    setLengthError(false);
  };
  const change = useChangePassword();

  const mismatch = confirm !== "" && next !== confirm;
  const canUpdate = current !== "" && next !== "" && next === confirm && !change.isPending;

  const update = () => {
    if (!canUpdate) return;
    if (!passwordLengthOk(next)) {
      setLengthError(true);
      return;
    }
    change.mutate({ currentPassword: current, newPassword: next }, {
      onSuccess: () => {
        onChanged();
        onClose();
      },
    });
  };

  const input = (label: string, value: string, onChange: (v: string) => void, autoComplete: string) => (
    <label className="flex flex-col gap-2">
      <span className="text-sm text-fg-faint">{label}</span>
      <input
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10.25 w-full rounded-xl bg-surface-2 px-4 py-3 text-[15px] text-fg outline-none focus:ring-1 focus:ring-green"
      />
    </label>
  );

  return (
    <Dialog
      title={t("settings.account.changePasswordTitle")}
      onClose={onClose}
      busy={change.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={update} disabled={!canUpdate}>{t("settings.account.updatePassword")}</Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          update();
        }}
      >
        {input(t("settings.account.currentPassword"), current, setCurrent, "current-password")}
        {input(t("settings.account.newPassword"), next, setNext, "new-password")}
        {input(t("settings.account.confirmNewPassword"), confirm, setConfirm, "new-password")}
        {lengthError && <p className="text-sm text-red">{t("auth.passwordLength")}</p>}
        {mismatch && <p className="text-sm text-red">{t("settings.account.passwordsDoNotMatch")}</p>}
        {change.isError && <p className="text-sm text-red">{t("settings.account.currentPasswordIncorrect")}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

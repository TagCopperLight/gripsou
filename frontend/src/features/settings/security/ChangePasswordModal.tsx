import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../../../lib/errorToasts";

import { Dialog } from "../../../ui/Dialog";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { TextInput } from "../../../ui/TextInput";
import { useChangePassword } from "../../../api/auth";
import { passwordError } from "../../../auth/throttle";
import { passwordLengthOk } from "../../../lib/password";

export function ChangePasswordModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const id = useId();
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

  // The length rule is checked here first, so a 400 is the current password.
  const currentError = passwordError(t, change.error, "settings.account.currentPasswordIncorrect");
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

  const input = (
    name: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    autoComplete: string,
    error: string | null,
    invalid = error !== null,
  ) => (
    <Field label={label} error={error} htmlFor={`${id}-${name}`}>
      <TextInput
        id={`${id}-${name}`}
        type="password"
        autoComplete={autoComplete}
        invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );

  useErrorToast(change.isError && currentError === null && t("settings.account.passwordUpdateFailed"));

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
        {input(
          "current",
          t("settings.account.currentPassword"),
          current,
          (v) => {
            setCurrent(v);
            change.reset();
          },
          "current-password",
          currentError,
        )}
        {input(
          "new",
          t("settings.account.newPassword"),
          next,
          setNext,
          "new-password",
          lengthError ? t("auth.passwordLength") : null,
          lengthError || mismatch,
        )}
        {input(
          "confirm",
          t("settings.account.confirmNewPassword"),
          confirm,
          setConfirm,
          "new-password",
          mismatch ? t("settings.account.passwordsDoNotMatch") : null,
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useErrorToast } from "../lib/errorToasts";

import { Dialog } from "./Dialog";
import { Button } from "./Button";
import { LabeledField } from "./FieldError";
import { TextInput } from "./TextInput";
import { ApiError } from "../api/client";
import { useChangePassword } from "../api/hooks";
import { throttleMinutes } from "../lib/mfa";
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

  // The server answers 400 for a wrong current password (the length rule is
  // checked here first); anything else is not the user's typing.
  const wrongCurrent = change.error instanceof ApiError && change.error.status === 400;
  const minutes = throttleMinutes(change.error);
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

  const currentError =
    minutes !== null ? t("auth.tooManyAttempts", { count: minutes }) : wrongCurrent ? t("settings.account.currentPasswordIncorrect") : null;

  const input = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    autoComplete: string,
    error: string | null,
    invalid = error !== null,
  ) => (
    <LabeledField label={label} error={error}>
      <TextInput
        type="password"
        autoComplete={autoComplete}
        invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </LabeledField>
  );

  useErrorToast(change.isError && minutes === null && !wrongCurrent && t("settings.account.passwordUpdateFailed"));

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
          t("settings.account.newPassword"),
          next,
          setNext,
          "new-password",
          lengthError ? t("auth.passwordLength") : null,
          lengthError || mismatch,
        )}
        {input(
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

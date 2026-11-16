import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "./Field";
import { TextInput } from "./TextInput";

export function PasswordField({
  value,
  onChange,
  autoFocus = false,
  label,
  danger = false,
  error = null,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  label?: string;
  danger?: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field label={label ?? t("settings.account.currentPassword")} error={error} htmlFor={`${id}-password`}>
      <TextInput id={`${id}-password`}
        type="password"
        autoComplete="current-password"
        autoFocus={autoFocus}
        danger={danger}
        invalid={Boolean(error)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

import { useTranslation } from "react-i18next";

import { LabeledField } from "./FieldError";
import { TextInput } from "./TextInput";

/** The signed-in user's current password, asked before a sensitive change.
 *  `danger` gives it a red ring, for a change that cannot be undone; `error`
 *  (a wrong password, too many attempts) shows under it, the ring red. */
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
  /** Defaults to "Current password". */
  label?: string;
  danger?: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <LabeledField label={label ?? t("settings.account.currentPassword")} error={error}>
      <TextInput
        type="password"
        autoComplete="current-password"
        autoFocus={autoFocus}
        danger={danger}
        invalid={Boolean(error)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </LabeledField>
  );
}

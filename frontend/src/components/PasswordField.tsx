import { useTranslation } from "react-i18next";

import { TextInput } from "./TextInput";

/** The signed-in user's current password, asked before a sensitive change.
 *  `danger` gives it a red ring, for a change that cannot be undone. */
export function PasswordField({
  value,
  onChange,
  autoFocus = false,
  label,
  danger = false,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  /** Defaults to "Current password". */
  label?: string;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm text-fg-faint">{label ?? t("settings.account.currentPassword")}</span>
      <TextInput
        type="password"
        autoComplete="current-password"
        autoFocus={autoFocus}
        danger={danger}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

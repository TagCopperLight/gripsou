import { useTranslation } from "react-i18next";

import { TextInput } from "./TextInput";

/** The signed-in user's current password, asked before a sensitive change. */
export function PasswordField({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm text-fg-faint">{t("settings.account.currentPassword")}</span>
      <TextInput
        type="password"
        autoComplete="current-password"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

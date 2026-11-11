import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextInput";
import type { FieldProblem, NewAccount, NewAccountField } from "./newAccount";

/** Email, name, password and its confirmation, as the invite and setup pages
 *  ask for them. A refused value shows under its field. */
export function NewAccountFields({
  account,
  onChange,
  error,
}: {
  account: NewAccount;
  onChange: (account: NewAccount) => void;
  error: FieldProblem<string> | null;
}) {
  const { t } = useTranslation();
  const id = useId();

  const field = (key: NewAccountField, label: string, type: string, autoComplete: string, invalid = error?.field === key) => (
    <Field label={label} labelClassName="text-fg-dim" error={error?.field === key && error.text} htmlFor={`${id}-${key}`}>
      <TextInput
        id={`${id}-${key}`}
        type={type}
        autoComplete={autoComplete}
        value={account[key]}
        onChange={(e) => onChange({ ...account, [key]: e.target.value })}
        invalid={invalid}
      />
    </Field>
  );

  return (
    <>
      {field("email", t("auth.email"), "email", "username")}
      {field("name", t("auth.name"), "text", "name")}
      {/* Two passwords that differ: either may be the wrong one. */}
      {field("password", t("auth.password"), "password", "new-password", error?.field === "password" || error?.field === "confirm")}
      {field("confirm", t("auth.confirmPassword"), "password", "new-password")}
    </>
  );
}

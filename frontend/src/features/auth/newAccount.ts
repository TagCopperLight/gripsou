import type { TFunction } from "i18next";

import { passwordLengthOk } from "../../lib/password";

export type NewAccount = { email: string; name: string; password: string; confirm: string };

export type NewAccountField = keyof NewAccount;

export const EMPTY_ACCOUNT: NewAccount = { email: "", name: "", password: "", confirm: "" };

export type FieldProblem<F extends string = NewAccountField> = { field: F; text: string };

export function newAccountProblem(t: TFunction, account: NewAccount): FieldProblem | null {
  if (!account.email.trim()) return { field: "email", text: t("auth.enterEmail") };
  if (!account.name.trim()) return { field: "name", text: t("auth.enterName") };
  if (!passwordLengthOk(account.password)) return { field: "password", text: t("auth.passwordLength") };
  if (account.password !== account.confirm) return { field: "confirm", text: t("auth.passwordsDontMatch") };
  return null;
}

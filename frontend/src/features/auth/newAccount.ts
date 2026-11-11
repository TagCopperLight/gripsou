import type { TFunction } from "i18next";

import { passwordLengthOk } from "../../lib/password";

/** What a new account is made of, on the invite and setup pages. */
export type NewAccount = { email: string; name: string; password: string; confirm: string };

export type NewAccountField = keyof NewAccount;

export const EMPTY_ACCOUNT: NewAccount = { email: "", name: "", password: "", confirm: "" };

/** What was refused, and which field it's about. */
export type FieldProblem<F extends string = NewAccountField> = { field: F; text: string };

/** The first thing the server would refuse in `account`, said by its field,
 *  or null when it can be sent. */
export function newAccountProblem(t: TFunction, account: NewAccount): FieldProblem | null {
  // The server refuses both empty; say so by the field instead.
  if (!account.email.trim()) return { field: "email", text: t("auth.enterEmail") };
  if (!account.name.trim()) return { field: "name", text: t("auth.enterName") };
  if (!passwordLengthOk(account.password)) return { field: "password", text: t("auth.passwordLength") };
  if (account.password !== account.confirm) return { field: "confirm", text: t("auth.passwordsDontMatch") };
  return null;
}

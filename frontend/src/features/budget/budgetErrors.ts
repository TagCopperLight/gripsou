import { useTranslation } from "react-i18next";

import { ApiError } from "../../api/client";
import { useErrorToast } from "../../lib/errorToasts";

export type BudgetErrorKey = "duplicate" | "gone" | "saveError";

/** The one place that turns a failed budget write into a translation key.
 *  Branches on `ApiError.status`, never on message text. */
export function budgetErrorKey(err: unknown): BudgetErrorKey {
  if (err instanceof ApiError) {
    if (err.status === 409) return "duplicate";
    if (err.status === 404) return "gone";
  }
  return "saveError";
}

/** Shows a failed budget write in the corner, worded from `namespace`'s
 *  `duplicate`/`gone`/`saveError` keys. `inline` is the failure the screen
 *  shows beside its field instead. */
export function useBudgetErrorToast(
  failure: BudgetErrorKey | null,
  namespace: string,
  inline?: BudgetErrorKey,
): void {
  const { t } = useTranslation();
  useErrorToast(
    failure !== null && failure !== inline && t(`${namespace}.${failure}`),
    failure === "gone" ? t("common.refreshPage") : undefined,
  );
}

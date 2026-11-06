import { ApiError } from "../../api/client";

/** The one place that turns a failed budget write into a translation key.
 *  Branches on `ApiError.status`, never on message text. */
export function budgetErrorKey(err: unknown): "duplicate" | "gone" | "saveError" {
  if (err instanceof ApiError) {
    if (err.status === 409) return "duplicate";
    if (err.status === 404) return "gone";
  }
  return "saveError";
}

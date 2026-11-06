import type { TFunction } from "i18next";

import { ApiError } from "../api/client";

/** Whole minutes to wait after a throttled (429) answer, at least one; null
 *  for any other error. */
export function throttleMinutes(err: unknown): number | null {
  return err instanceof ApiError && err.status === 429
    ? Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60))
    : null;
}

/** "Too many attempts, try again in N minutes", or null when `err` isn't a
 *  throttled answer. */
export function throttledError(t: TFunction, err: unknown): string | null {
  const minutes = throttleMinutes(err);
  return minutes === null ? null : t("auth.tooManyAttempts", { count: minutes });
}

/** What to say under a password field after `err`: throttled, or the
 *  password was wrong (the server answers 400). Null for any other failure,
 *  which is not the user's typing to fix. */
export function passwordError(t: TFunction, err: unknown, wrongKey = "twoFactor.wrongPassword"): string | null {
  return throttledError(t, err) ?? (err instanceof ApiError && err.status === 400 ? t(wrongKey) : null);
}

import { ApiError } from "../api/client";

/** Whole minutes to wait after a throttled (429) answer, at least one; null
 *  for any other error. */
export function throttleMinutes(err: unknown): number | null {
  return err instanceof ApiError && err.status === 429
    ? Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60))
    : null;
}

/** What a 6-digit code field keeps of what was typed or pasted. */
export function sixDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

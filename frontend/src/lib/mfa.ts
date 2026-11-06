import { TOTP_DIGITS } from "../api/wire";

/** What an authenticator code field keeps of what was typed or pasted. */
export function codeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, TOTP_DIGITS);
}

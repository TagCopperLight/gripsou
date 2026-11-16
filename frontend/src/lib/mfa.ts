import { TOTP_DIGITS } from "../api/wire";

export function codeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, TOTP_DIGITS);
}

import { PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS } from "../api/wire";

/** The server's rule for a new password: length only, counted in characters
 *  (code points), so both sides agree on emoji. */
export function passwordLengthOk(pw: string): boolean {
  const n = [...pw].length;
  return n >= PASSWORD_MIN_CHARS && n <= PASSWORD_MAX_CHARS;
}

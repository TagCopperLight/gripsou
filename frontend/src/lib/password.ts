import { PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS } from "../api/wire";

/** Counted in code points so both sides agree on emoji. */
export function passwordLengthOk(pw: string): boolean {
  const n = [...pw].length;
  return n >= PASSWORD_MIN_CHARS && n <= PASSWORD_MAX_CHARS;
}

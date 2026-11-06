// Mirrors the server's rule (api/src/auth.rs validate_new_password): length
// only, counted in characters (code points), so both sides agree on emoji.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export function passwordLengthOk(pw: string): boolean {
  const n = [...pw].length;
  return n >= PASSWORD_MIN && n <= PASSWORD_MAX;
}

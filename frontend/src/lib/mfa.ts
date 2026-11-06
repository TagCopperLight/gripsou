/** What a 6-digit code field keeps of what was typed or pasted. */
export function sixDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

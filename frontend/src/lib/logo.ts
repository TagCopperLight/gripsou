/** A provider's logo value, when it is an image: an http(s) or root-relative
 *  URL. Anything else (a colour, an empty string) is no logo, and the badge
 *  falls back to its initials or glyph. */
export function logoUrl(logo: string | null | undefined): string | null {
  return logo && (logo.startsWith("http") || logo.startsWith("/")) ? logo : null;
}

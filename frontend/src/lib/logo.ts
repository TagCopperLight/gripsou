/** The value when it is an http(s) or root-relative URL; else no logo (a colour, empty). */
export function logoUrl(logo: string | null | undefined): string | null {
  return logo && (logo.startsWith("http") || logo.startsWith("/")) ? logo : null;
}

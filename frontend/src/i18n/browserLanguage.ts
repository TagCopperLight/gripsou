export function browserLanguage(
  languages: readonly string[] = navigator.languages?.length ? navigator.languages : [navigator.language],
): "en" | "fr" {
  const first = languages.find((l) => /^(en|fr)\b/i.test(l));
  return first?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

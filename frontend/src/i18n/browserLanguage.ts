/** The UI language the browser asks for: the first of its languages the app
 *  speaks, else English. */
export function browserLanguage(
  languages: readonly string[] = navigator.languages?.length ? navigator.languages : [navigator.language],
): "en" | "fr" {
  const first = languages.find((l) => /^(en|fr)\b/i.test(l));
  return first?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

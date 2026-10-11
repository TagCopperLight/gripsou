import { DEFAULT_PREFS, type UserPrefs } from "./prefs";

/** Language and time zone as the browser reports them. Browsers expose no
 *  currency, so that one stays at its default (EUR). */
export function browserPrefs(
  languages: readonly string[] = navigator.languages?.length ? navigator.languages : [navigator.language],
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { uiLanguage: UserPrefs["uiLanguage"]; timeZone: string } {
  const first = languages.find((l) => /^(en|fr)\b/i.test(l));
  return {
    uiLanguage: first?.toLowerCase().startsWith("fr") ? "fr" : "en",
    timeZone: timeZone || DEFAULT_PREFS.timeZone,
  };
}

/** The welcome screen's starting prefs: language and time zone still at their
 *  defaults take the browser's; anything the user already chose is kept. */
export function prefillFromBrowser(
  prefs: UserPrefs,
  detected: ReturnType<typeof browserPrefs> = browserPrefs(),
): UserPrefs {
  return {
    ...prefs,
    uiLanguage: prefs.uiLanguage === DEFAULT_PREFS.uiLanguage ? detected.uiLanguage : prefs.uiLanguage,
    timeZone: prefs.timeZone === DEFAULT_PREFS.timeZone ? detected.timeZone : prefs.timeZone,
  };
}

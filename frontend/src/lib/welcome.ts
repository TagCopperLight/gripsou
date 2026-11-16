import { browserLanguage } from "../i18n/browserLanguage";
import { DEFAULT_PREFS, type UserPrefs } from "../api/wire";

/** Browsers expose no currency, so that stays at its default. */
export function browserPrefs(
  languages?: readonly string[],
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { uiLanguage: UserPrefs["uiLanguage"]; timeZone: string } {
  return {
    uiLanguage: browserLanguage(languages),
    timeZone: timeZone || DEFAULT_PREFS.timeZone,
  };
}

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

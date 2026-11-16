import type { UserPrefs } from "../api/wire";

type Language = UserPrefs["uiLanguage"];

const KEY = "gripsou.uiLanguage";

/** The language of the last user signed in on this device. A page drawn while
 *  their saved session is checked speaks it from the start, rather than the
 *  browser's language until the check names the user's own. */
export function savedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "en" || saved === "fr" ? saved : null;
  } catch {
    return null;
  }
}

export function saveLanguage(language: Language): void {
  try {
    localStorage.setItem(KEY, language);
  } catch {
    // Storage unavailable: the next visit starts in the browser's language.
  }
}

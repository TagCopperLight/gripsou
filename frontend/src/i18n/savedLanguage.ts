import type { UserPrefs } from "../api/wire";

type Language = UserPrefs["uiLanguage"];

const KEY = "gripsou.uiLanguage";

/** A page drawn while the saved session is checked speaks it from the start. */
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

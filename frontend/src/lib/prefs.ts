import { DEFAULT_PREFS, type UserPrefs } from "../api/wire";

// Fallback for the formatters in money.ts and date.ts. Not reactive: components use `usePrefs()`.
let current: UserPrefs = DEFAULT_PREFS;

export function getPrefs(): UserPrefs {
  return current;
}

export function setPrefs(prefs: UserPrefs): void {
  current = prefs;
}

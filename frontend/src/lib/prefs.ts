import { DEFAULT_PREFS, type UserPrefs } from "../api/wire";

// The prefs the formatters in money.ts and date.ts fall back on when a call
// passes none. AuthProvider writes it with every user it shows. It is not
// reactive: a component reads `usePrefs()` (auth/context), which re-renders.
let current: UserPrefs = DEFAULT_PREFS;

export function getPrefs(): UserPrefs {
  return current;
}

export function setPrefs(prefs: UserPrefs): void {
  current = prefs;
}

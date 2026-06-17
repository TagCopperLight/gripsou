// Per-user localization & formatting preferences. Mirrors the backend
// `UserPrefs` (users.prefs JSONB). Held in a module singleton so the plain
// formatter functions in lib/money.ts / lib/date.ts can read it without every
// call site threading prefs through — the AuthProvider keeps it in sync. React
// reactivity comes from the auth context; this singleton is the default source.

export type CurrencyPosition = "before" | "after";

export type UserPrefs = {
  uiLanguage: "en" | "fr";
  dateFormat: string;
  numberGroupSep: string;
  numberDecimalSep: string;
  numberDecimals: number;
  currencySymbol: string;
  currencyPosition: CurrencyPosition;
  percentDecimals: number;
};

export const DEFAULT_PREFS: UserPrefs = {
  uiLanguage: "en",
  dateFormat: "DD/MM/YYYY",
  numberGroupSep: " ",
  numberDecimalSep: ",",
  numberDecimals: 2,
  currencySymbol: "€",
  currencyPosition: "after",
  percentDecimals: 2,
};

let current: UserPrefs = DEFAULT_PREFS;

export function getPrefs(): UserPrefs {
  return current;
}

export function setPrefs(prefs: UserPrefs): void {
  current = prefs;
}

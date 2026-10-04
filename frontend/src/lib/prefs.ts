// Per-user localization & formatting preferences. Mirrors the backend
// `UserPrefs` (users.prefs JSONB). Held in a module singleton so the plain
// formatter functions in lib/money.ts / lib/date.ts can read it without every
// call site threading prefs through — the AuthProvider keeps it in sync. React
// reactivity comes from the auth context; this singleton is the default source.

export type CurrencyPosition = "before" | "after";

export type UserPrefs = {
  uiLanguage: "en" | "fr";
  dateFormat: string;
  /** IANA timezone defining today and the display of real timestamps. */
  timeZone: string;
  numberGroupSep: string;
  numberDecimalSep: string;
  numberDecimals: number;
  currency: string;
  currencyPosition: CurrencyPosition;
  percentDecimals: number;
  /** Masks the headline net-worth figure on the dashboard and accounts pages. */
  privateMode: boolean;
  /** Shows the ✓ column in the budget transactions table. The user's own
   *  bookkeeping — it confirms nothing and categorises nothing. */
  showChecked: boolean;
  /** Opt-in to AI categorisation. Mirrors the backend `budget_ai_enabled`. */
  budgetAiEnabled: boolean;
  /** Review threshold, integer percent (50–95). */
  budgetAiThreshold: number;
  avatar?: string;
};

export const DEFAULT_PREFS: UserPrefs = {
  uiLanguage: "en",
  dateFormat: "DD/MM/YYYY",
  timeZone: "Europe/Paris",
  numberGroupSep: " ",
  numberDecimalSep: ",",
  numberDecimals: 2,
  currency: "EUR",
  currencyPosition: "after",
  percentDecimals: 2,
  privateMode: false,
  showChecked: false,
  budgetAiEnabled: false,
  budgetAiThreshold: 70,
};

let current: UserPrefs = DEFAULT_PREFS;

export function getPrefs(): UserPrefs {
  return current;
}

export function setPrefs(prefs: UserPrefs): void {
  current = prefs;
}

// Per-user localization & formatting preferences. Mirrors the backend
// `UserPrefs` (users.prefs JSONB).

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

/** The settings one save changes, the rest untouched. `avatar: null` removes it. */
export type PrefsPatch = Partial<Omit<UserPrefs, "avatar">> & { avatar?: string | null };

export function withPatch(prefs: UserPrefs, patch: PrefsPatch): UserPrefs {
  const { avatar, ...rest } = { ...prefs, ...patch };
  return avatar === null || avatar === undefined ? rest : { ...rest, avatar };
}

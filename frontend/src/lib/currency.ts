// Currency codes ↔ display symbols. The backend stores and converts by ISO
// code (users.prefs.currency, instrument.currency); the symbol is purely
// presentational and lives here so the settings picker and the formatters
// agree. An unlisted code renders as itself, which is a correct if plain label.

export const CURRENCIES: { code: string; label: string }[] = [
  { code: "EUR", label: "EUR (€)" },
  { code: "USD", label: "USD ($)" },
  { code: "GBP", label: "GBP (£)" },
  { code: "CHF", label: "CHF" },
  { code: "JPY", label: "JPY (¥)" },
  { code: "CNY", label: "CNY (¥)" },
];

const SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: "CHF",
  JPY: "¥",
  CNY: "¥",
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code;
}

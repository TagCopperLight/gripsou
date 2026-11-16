// Symbols are display only: the backend stores and converts by ISO code.
// An unlisted code renders as itself.

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

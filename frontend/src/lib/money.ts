// Money/quantities arrive from the API as decimal strings (never floats — see
// CLAUDE.md). We use Intl.NumberFormat (en-US, predictable part types) only for
// digit grouping + rounding structure, then substitute the user's independent
// separators / currency symbol from prefs. This supports free-form combinations
// (e.g. US dates + French separators + symbol-after) that a single locale can't.

import { getPrefs } from "./prefs";
import { currencySymbol } from "./currency";

type SignOption = {
  /** Prefix with + (positive) / - (negative). Zero stays unsigned. */
  signed?: boolean;
};

type SepOptions = {
  /** Thousands group separator. Defaults to prefs. */
  groupSep?: string;
  /** Decimal separator. Defaults to prefs. */
  decimalSep?: string;
};

export type MoneyFormatOptions = SignOption &
  SepOptions & {
    /** ISO code to format in, when it isn't the user's reporting currency
     * (e.g. a native unit price). Defaults to prefs.currency. */
    currency?: string;
    /** Raw symbol override, bypassing the code→symbol map. */
    currencySymbol?: string;
    /** Defaults to prefs.currencyPosition. */
    currencyPosition?: "before" | "after";
    /** Fixed fraction digits. Defaults to prefs.numberDecimals. */
    fractionDigits?: number;
  };

export type PercentFormatOptions = SignOption &
  SepOptions & {
    /** Max fraction digits. Defaults to prefs.percentDecimals. */
    fractionDigits?: number;
  };

type RenderOptions = {
  style: "decimal" | "percent";
  groupSep: string;
  decimalSep: string;
  minFrac: number;
  maxFrac: number;
  signed: boolean;
};

// Format with Intl for structure, swap separators, and return the sign apart
// from the body so callers can place a currency symbol between them.
function renderParts(
  value: string | number,
  o: RenderOptions,
): { sign: string; body: string } {
  const parts = new Intl.NumberFormat("en-US", {
    style: o.style,
    useGrouping: "always",
    minimumFractionDigits: o.minFrac,
    maximumFractionDigits: o.maxFrac,
    signDisplay: o.signed ? "exceptZero" : "auto",
  }).formatToParts(value as unknown as number);

  let sign = "";
  let body = "";
  for (const p of parts) {
    if (p.type === "minusSign" || p.type === "plusSign") sign = p.value;
    else if (p.type === "group") body += o.groupSep;
    else if (p.type === "decimal") body += o.decimalSep;
    else body += p.value;
  }
  return { sign, body };
}

export function formatMoney(
  value: string | number,
  options: MoneyFormatOptions = {},
): string {
  const p = getPrefs();
  const frac = options.fractionDigits ?? p.numberDecimals;
  const { sign, body } = renderParts(value, {
    style: "decimal",
    groupSep: options.groupSep ?? p.numberGroupSep,
    decimalSep: options.decimalSep ?? p.numberDecimalSep,
    minFrac: frac,
    maxFrac: frac,
    signed: options.signed ?? false,
  });
  const symbol =
    options.currencySymbol ?? currencySymbol(options.currency ?? p.currency);
  const position = options.currencyPosition ?? p.currencyPosition;
  const withSymbol =
    position === "before" ? `${symbol}${body}` : `${body} ${symbol}`;
  return `${sign}${withSymbol}`;
}

export function formatQuantity(
  value: string | number,
  options: SepOptions & { fractionDigits?: number } = {},
): string {
  const p = getPrefs();
  const { sign, body } = renderParts(value, {
    style: "decimal",
    groupSep: options.groupSep ?? p.numberGroupSep,
    decimalSep: options.decimalSep ?? p.numberDecimalSep,
    minFrac: 0,
    maxFrac: options.fractionDigits ?? 2,
    signed: false,
  });
  return `${sign}${body}`;
}

/** An FR keyboard under `inputMode="decimal"` produces `16,03`, so a comma has
 *  to be readable as a decimal separator. But `16,029` (three decimals, like
 *  the PEA's real unit price) and `1,234` (en-US grouping) are indistinguishable
 *  from the string alone, and guessing wrong posts a value 1000x off in silence.
 *
 *  So the reader is locale-led: under `fr` a comma is the decimal separator,
 *  which is what the French keyboard produces and what French formatting means.
 *  Under any other language a comma is grouping, and a decimal comma is not
 *  expected — so anything containing one is left alone for `DECIMAL_RE` to
 *  reject, and the user is told rather than silently misread. Mixed or repeated
 *  separators are always ambiguous and always refused. */
export function normaliseDecimal(raw: string, language: string): string {
  const s = raw.trim();
  // Both separators, or more than one comma: grouped, never unambiguous.
  if (s.includes(".") && s.includes(",")) return s;
  if ((s.match(/,/g) ?? []).length > 1) return s;
  if (!language.toLowerCase().startsWith("fr")) return s;
  return s.replace(",", ".");
}

export const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export type ValidationError = "invalidNumber" | "nonPositiveQuantity" | "negativeUnitPrice";

/** Mirrors the server's validation rules so a malformed row is caught with a
 *  specific, translated message instead of a generic "row N failed" once it
 *  round-trips to the API and back as a 400. */
export function validateRow(quantity: string, unitPrice: string): ValidationError | null {
  if (!DECIMAL_RE.test(quantity) || !DECIMAL_RE.test(unitPrice)) return "invalidNumber";
  if (Number(quantity) <= 0) return "nonPositiveQuantity";
  if (Number(unitPrice) < 0) return "negativeUnitPrice";
  return null;
}

export function formatPercent(
  value: string | number,
  options: PercentFormatOptions = {},
): string {
  const p = getPrefs();
  // Value is a ratio (0.1234 = 12.34%); Intl percent style multiplies by 100
  // and appends the % sign (captured in body via the percentSign part).
  const { sign, body } = renderParts(value, {
    style: "percent",
    groupSep: options.groupSep ?? p.numberGroupSep,
    decimalSep: options.decimalSep ?? p.numberDecimalSep,
    minFrac: 0,
    maxFrac: options.fractionDigits ?? p.percentDecimals,
    signed: options.signed ?? false,
  });
  return `${sign}${body}`;
}
